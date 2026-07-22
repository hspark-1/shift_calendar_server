import crypto from "crypto";
import { Transaction } from "sequelize";
import type { RedisClientType } from "redis";
import { sequelize } from "../config/database";
import {
  getRedisClient,
  isWorkShiftCacheEnabled,
  withRedisCommandTimeout,
} from "../config/redis";
import { getPositiveIntegerEnvironmentVariable } from "../config/environment";
import { WorkShiftMonthState } from "../models";
import { WorkShiftApiModel } from "../types/workShift";

const schema_version = 1;

const read_snapshot_script = `
local snapshot = redis.call('GET', KEYS[1])
if not snapshot then return false end
local fence = redis.call('GET', KEYS[2])
if fence then
  local ok, value = pcall(cjson.decode, snapshot)
  local revision_type = ok and type(value.revision) or 'nil'
  local snapshot_revision = nil
  if revision_type == 'string' or revision_type == 'number' then
    snapshot_revision = tonumber(value.revision)
  end
  local fence_revision = tonumber(fence)
  if not snapshot_revision or not fence_revision or snapshot_revision < fence_revision then
    redis.call('DEL', KEYS[1])
    return false
  end
end
return snapshot
`;

const write_snapshot_script = `
local fence = redis.call('GET', KEYS[2])
local snapshot_revision = tonumber(ARGV[2])
if not snapshot_revision then return 0 end
if fence then
  local fence_revision = tonumber(fence)
  if not fence_revision or fence_revision > snapshot_revision then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

const invalidate_snapshot_script = `
local fence = redis.call('GET', KEYS[2])
local target_revision = tonumber(ARGV[1])
if not target_revision then return 0 end
if not fence or not tonumber(fence) or tonumber(fence) < target_revision then
  redis.call('SET', KEYS[2], ARGV[1])
end
redis.call('DEL', KEYS[1])
return 1
`;

const release_lock_script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface WorkShiftMonthSnapshot {
  schema_version: 1;
  owner_user_id: string;
  year_month: string;
  revision: string;
  last_modified_at: string | null;
  cached_at: string;
  expires_at: string;
  work_shifts: WorkShiftApiModel[];
}

export interface WorkShiftRangeResult {
  work_shifts: WorkShiftApiModel[];
  revisions: Array<{ year_month: string; revision: string }>;
  cache_result: "hit" | "miss" | "bypass";
}

type MonthLoader = (
  start_date: string,
  end_date: string,
  transaction?: Transaction,
) => Promise<WorkShiftApiModel[]>;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toYearMonth(date: string): string {
  return date.slice(0, 7);
}

export function toMonthStart(year_month: string): string {
  return `${year_month}-01`;
}

export function getMonthEnd(year_month: string): string {
  const [year, month] = year_month.split("-").map(Number);
  return `${year_month}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

export function getMonthsInRange(start_date: string, end_date: string): string[] {
  const [start_year, start_month] = start_date.slice(0, 7).split("-").map(Number);
  const [end_year, end_month] = end_date.slice(0, 7).split("-").map(Number);
  const months: string[] = [];
  let year = start_year;
  let month = start_month;

  while (year < end_year || (year === end_year && month <= end_month)) {
    months.push(`${year}-${pad(month)}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

function getKeyPrefix(): string {
  return (process.env.CACHE_KEY_PREFIX || "shiftmate:local").replace(/:+$/, "");
}

export function getWorkShiftCacheKeys(owner_user_id: string, year_month: string) {
  const compact_month = year_month.replace("-", "");
  const snapshot_key = `${getKeyPrefix()}:work-shifts:v1:${owner_user_id}:${compact_month}`;
  return {
    snapshot_key,
    revision_key: `${snapshot_key}:revision`,
    lock_key: `${snapshot_key}:lock`,
  };
}

function isValidSnapshot(
  value: unknown,
  owner_user_id: string,
  year_month: string,
): value is WorkShiftMonthSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<WorkShiftMonthSnapshot>;
  return (
    snapshot.schema_version === schema_version &&
    snapshot.owner_user_id === owner_user_id &&
    snapshot.year_month === year_month &&
    typeof snapshot.revision === "string" &&
    /^\d+$/.test(snapshot.revision) &&
    (snapshot.last_modified_at === null ||
      (typeof snapshot.last_modified_at === "string" &&
        !Number.isNaN(Date.parse(snapshot.last_modified_at)))) &&
    typeof snapshot.cached_at === "string" &&
    !Number.isNaN(Date.parse(snapshot.cached_at)) &&
    typeof snapshot.expires_at === "string" &&
    !Number.isNaN(Date.parse(snapshot.expires_at)) &&
    Array.isArray(snapshot.work_shifts) &&
    snapshot.work_shifts.every(isValidWorkShiftApiModel)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isValidWorkShiftApiModel(value: unknown): value is WorkShiftApiModel {
  if (!value || typeof value !== "object") return false;
  const work_shift = value as Partial<WorkShiftApiModel>;
  return (
    typeof work_shift.work_shift_id === "string" &&
    typeof work_shift.work_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(work_shift.work_date) &&
    typeof work_shift.shift_type_code === "string" &&
    typeof work_shift.shift_type_name === "string" &&
    isNullableString(work_shift.shift_type_color) &&
    isNullableString(work_shift.start_time) &&
    isNullableString(work_shift.end_time) &&
    isNullableString(work_shift.note) &&
    typeof work_shift.created_at === "string" &&
    !Number.isNaN(Date.parse(work_shift.created_at)) &&
    typeof work_shift.updated_at === "string" &&
    !Number.isNaN(Date.parse(work_shift.updated_at))
  );
}

async function readSnapshot(
  client: RedisClientType,
  owner_user_id: string,
  year_month: string,
): Promise<WorkShiftMonthSnapshot | null> {
  const keys = getWorkShiftCacheKeys(owner_user_id, year_month);
  const raw = await withRedisCommandTimeout(
    client.eval(read_snapshot_script, {
      keys: [keys.snapshot_key, keys.revision_key],
      arguments: [],
    }),
  );
  if (typeof raw !== "string") return null;

  try {
    const parsed = JSON.parse(raw);
    if (isValidSnapshot(parsed, owner_user_id, year_month)) return parsed;
  } catch {
    // 아래 공통 삭제 경로에서 손상된 snapshot을 제거한다.
  }
  await withRedisCommandTimeout(client.del(keys.snapshot_key)).catch(
    () => undefined,
  );
  return null;
}

async function loadMonthFromDatabase(
  owner_user_id: string,
  year_month: string,
  loader: MonthLoader,
): Promise<WorkShiftMonthSnapshot> {
  return sequelize.transaction(
    {
      isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ,
      readOnly: true,
    },
    async (transaction) => {
      // Sequelize v6의 readOnly 옵션은 읽기 전용 커넥션 선택에만 사용되므로,
      // PostgreSQL 트랜잭션 자체에도 쓰기 금지를 명시한다.
      await sequelize.query("SET TRANSACTION READ ONLY", { transaction });
      const state = await WorkShiftMonthState.findOne({
        where: { owner_user_id, year_month: toMonthStart(year_month) },
        transaction,
      });
      const work_shifts = await loader(
        toMonthStart(year_month),
        getMonthEnd(year_month),
        transaction,
      );
      const now = new Date();
      const base_ttl = getPositiveIntegerEnvironmentVariable(
        "WORK_SHIFT_CACHE_TTL_SECONDS",
        86400,
      );
      const jitter_limit = getPositiveIntegerEnvironmentVariable(
        "WORK_SHIFT_CACHE_TTL_JITTER_SECONDS",
        3600,
        { allow_zero: true },
      );
      const jitter = jitter_limit > 0 ? crypto.randomInt(jitter_limit + 1) : 0;
      const expires_at = new Date(now.getTime() + (base_ttl + jitter) * 1000);

      return {
        schema_version,
        owner_user_id,
        year_month,
        revision: state?.revision ?? "0",
        last_modified_at: state?.last_modified_at?.toISOString() ?? null,
        cached_at: now.toISOString(),
        expires_at: expires_at.toISOString(),
        work_shifts,
      };
    },
  );
}

async function writeSnapshot(
  client: RedisClientType,
  snapshot: WorkShiftMonthSnapshot,
): Promise<void> {
  const keys = getWorkShiftCacheKeys(
    snapshot.owner_user_id,
    snapshot.year_month,
  );
  const ttl_seconds = Math.max(
    1,
    Math.ceil((Date.parse(snapshot.expires_at) - Date.now()) / 1000),
  );
  await withRedisCommandTimeout(
    client.eval(write_snapshot_script, {
      keys: [keys.snapshot_key, keys.revision_key],
      arguments: [JSON.stringify(snapshot), snapshot.revision, String(ttl_seconds)],
    }),
  );
}

async function getMonthSnapshot(
  client: RedisClientType,
  owner_user_id: string,
  year_month: string,
  loader: MonthLoader,
): Promise<{ snapshot: WorkShiftMonthSnapshot; cache_hit: boolean }> {
  const cached = await readSnapshot(client, owner_user_id, year_month);
  if (cached) return { snapshot: cached, cache_hit: true };

  const keys = getWorkShiftCacheKeys(owner_user_id, year_month);
  const lock_token = crypto.randomUUID();
  const lock_ms = getPositiveIntegerEnvironmentVariable(
    "WORK_SHIFT_CACHE_LOCK_MS",
    5000,
  );
  const acquired = await withRedisCommandTimeout(
    client.set(keys.lock_key, lock_token, { NX: true, PX: lock_ms }),
  );

  if (acquired === "OK") {
    try {
      const snapshot = await loadMonthFromDatabase(owner_user_id, year_month, loader);
      await writeSnapshot(client, snapshot).catch(() => undefined);
      return { snapshot, cache_hit: false };
    } finally {
      await withRedisCommandTimeout(
        client.eval(release_lock_script, {
          keys: [keys.lock_key],
          arguments: [lock_token],
        }),
      ).catch(() => undefined);
    }
  }

  const wait_ms = getPositiveIntegerEnvironmentVariable(
    "WORK_SHIFT_CACHE_WAIT_MS",
    500,
  );
  const deadline = Date.now() + wait_ms;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const retried = await readSnapshot(client, owner_user_id, year_month);
    if (retried) return { snapshot: retried, cache_hit: true };
  }

  return {
    snapshot: await loadMonthFromDatabase(owner_user_id, year_month, loader),
    cache_hit: false,
  };
}

async function loadRevisionsWithoutCache(
  owner_user_id: string,
  months: string[],
): Promise<Array<{ year_month: string; revision: string }>> {
  const states = await WorkShiftMonthState.findAll({
    where: {
      owner_user_id,
      year_month: months.map(toMonthStart),
    },
  });
  const by_month = new Map(
    states.map((state) => [state.year_month.slice(0, 7), state.revision]),
  );
  return months.map((year_month) => ({
    year_month,
    revision: by_month.get(year_month) ?? "0",
  }));
}

export async function getWorkShiftRange(
  owner_user_id: string,
  start_date: string,
  end_date: string,
  month_loader: MonthLoader,
  range_loader: MonthLoader,
): Promise<WorkShiftRangeResult> {
  const months = getMonthsInRange(start_date, end_date);
  if (!isWorkShiftCacheEnabled()) {
    const [work_shifts, revisions] = await Promise.all([
      range_loader(start_date, end_date),
      loadRevisionsWithoutCache(owner_user_id, months),
    ]);
    return { work_shifts, revisions, cache_result: "bypass" };
  }

  const client = await getRedisClient();
  if (!client) {
    const [work_shifts, revisions] = await Promise.all([
      range_loader(start_date, end_date),
      loadRevisionsWithoutCache(owner_user_id, months),
    ]);
    return { work_shifts, revisions, cache_result: "bypass" };
  }

  try {
    const results = await Promise.all(
      months.map((year_month) =>
        getMonthSnapshot(client, owner_user_id, year_month, month_loader),
      ),
    );
    const work_shifts = results
      .flatMap(({ snapshot }) => snapshot.work_shifts)
      .filter(
        (work_shift) =>
          work_shift.work_date >= start_date && work_shift.work_date <= end_date,
      )
      .sort((left, right) => left.work_date.localeCompare(right.work_date));
    return {
      work_shifts,
      revisions: results.map(({ snapshot }) => ({
        year_month: snapshot.year_month,
        revision: snapshot.revision,
      })),
      cache_result: results.every(({ cache_hit }) => cache_hit) ? "hit" : "miss",
    };
  } catch {
    const [work_shifts, revisions] = await Promise.all([
      range_loader(start_date, end_date),
      loadRevisionsWithoutCache(owner_user_id, months),
    ]);
    return { work_shifts, revisions, cache_result: "bypass" };
  }
}

export function createWorkShiftEtag(
  owner_user_id: string,
  start_date: string,
  end_date: string,
  revisions: Array<{ year_month: string; revision: string }>,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ owner_user_id, start_date, end_date, revisions }))
    .digest("base64url");
  return `"work-shifts-${digest}"`;
}

export async function invalidateWorkShiftMonth(
  owner_user_id: string,
  year_month: string,
  revision: string,
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  const keys = getWorkShiftCacheKeys(owner_user_id, year_month);
  try {
    await withRedisCommandTimeout(
      client.eval(invalidate_snapshot_script, {
        keys: [keys.snapshot_key, keys.revision_key],
        arguments: [revision],
      }),
    );
    return true;
  } catch {
    return false;
  }
}
