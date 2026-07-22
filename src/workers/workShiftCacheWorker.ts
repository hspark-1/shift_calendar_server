import crypto from "crypto";
import { QueryTypes } from "sequelize";
import {
  checkDatabaseConnection,
  connectDatabase,
  disconnectDatabase,
  sequelize,
} from "../config/database";
import {
  checkRedisConnection,
  disconnectRedis,
  isWorkShiftCacheEnabled,
} from "../config/redis";
import {
  getRequiredEnvironmentVariable,
  getPositiveIntegerEnvironmentVariable,
  validateEnvironment,
} from "../config/environment";
import { invalidateWorkShiftMonth } from "../services/workShiftMonthCacheService";
import { logError } from "../utils/logger";

interface ClaimedEvent {
  event_id: string;
  owner_user_id: string;
  year_month: string | Date;
  revision: string;
  attempt_count: number;
}

let is_stopping = false;

function formatYearMonth(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  return String(value).slice(0, 7);
}

async function claimEvents(): Promise<{
  claim_token: string;
  events: ClaimedEvent[];
}> {
  const claim_token = crypto.randomUUID();
  const batch_size = getPositiveIntegerEnvironmentVariable(
    "CACHE_OUTBOX_BATCH_SIZE",
    100,
  );
  const events = await sequelize.transaction(async (transaction) =>
    sequelize.query<ClaimedEvent>(
      `
      UPDATE work_shift_cache_outbox
      SET claim_token = :claim_token,
          claimed_at = now(),
          attempt_count = attempt_count + 1
      WHERE event_id IN (
        SELECT event_id
        FROM work_shift_cache_outbox
        WHERE processed_at IS NULL
          AND next_attempt_at <= now()
          AND (claimed_at IS NULL OR claimed_at < now() - interval '60 seconds')
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT :batch_size
      )
      RETURNING event_id, owner_user_id, year_month, revision, attempt_count
      `,
      {
        replacements: { claim_token, batch_size },
        type: QueryTypes.SELECT,
        transaction,
      },
    ),
  );
  return { claim_token, events };
}

async function markProcessed(
  claim_token: string,
  event_ids: string[],
): Promise<void> {
  if (event_ids.length === 0) return;
  await sequelize.query(
    `
    UPDATE work_shift_cache_outbox
    SET processed_at = now(),
        claimed_at = NULL,
        claim_token = NULL,
        last_error_code = NULL
    WHERE claim_token = :claim_token
      AND event_id IN (:event_ids)
    `,
    { replacements: { claim_token, event_ids } },
  );
}

async function markFailed(
  claim_token: string,
  events: ClaimedEvent[],
): Promise<void> {
  const event_ids = events.map((event) => event.event_id);
  if (event_ids.length === 0) return;
  await sequelize.query(
    `
    UPDATE work_shift_cache_outbox
    SET next_attempt_at = now() + make_interval(
          secs => LEAST(60, CAST(power(2, LEAST(attempt_count - 1, 6)) AS integer))
        ),
        claimed_at = NULL,
        claim_token = NULL,
        last_error_code = 'REDIS_INVALIDATION_FAILED'
    WHERE claim_token = :claim_token
      AND event_id IN (:event_ids)
    `,
    { replacements: { claim_token, event_ids } },
  );
}

function groupEvents(events: ClaimedEvent[]): ClaimedEvent[][] {
  const groups = new Map<string, ClaimedEvent[]>();
  for (const event of events) {
    const year_month = formatYearMonth(event.year_month);
    const key = `${event.owner_user_id}:${year_month}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function processOutboxBatch(): Promise<number> {
  const { claim_token, events } = await claimEvents();
  if (events.length === 0) return 0;

  for (const group of groupEvents(events)) {
    const latest_event = group.reduce((latest, current) =>
      BigInt(current.revision) > BigInt(latest.revision) ? current : latest,
    );
    const success = await invalidateWorkShiftMonth(
      latest_event.owner_user_id,
      formatYearMonth(latest_event.year_month),
      latest_event.revision,
    );
    if (success) {
      await markProcessed(
        claim_token,
        group.map((event) => event.event_id),
      );
    } else {
      await markFailed(claim_token, group);
    }
  }

  return events.length;
}

export async function cleanupProcessedEvents(): Promise<void> {
  await sequelize.query(
    `
    DELETE FROM work_shift_cache_outbox
    WHERE processed_at < now() - interval '7 days'
    `,
  );
}

async function runHealthCheck(): Promise<void> {
  validateEnvironment();
  getRequiredEnvironmentVariable("REDIS_URL");
  getRequiredEnvironmentVariable("CACHE_KEY_PREFIX");
  try {
    await connectDatabase();
    await checkDatabaseConnection();
    const redis_status = await checkRedisConnection({ force_connection: true });
    if (redis_status !== "ready") throw new Error("REDIS_NOT_READY");
  } finally {
    await disconnectRedis().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (is_stopping) return;
  is_stopping = true;
  console.log(JSON.stringify({ context: "cache_worker_stopping", signal }));
  await disconnectRedis().catch(() => undefined);
  await disconnectDatabase().catch(() => undefined);
}

async function runWorker(): Promise<void> {
  validateEnvironment();
  getRequiredEnvironmentVariable("REDIS_URL");
  getRequiredEnvironmentVariable("CACHE_KEY_PREFIX");
  await connectDatabase();
  if ((await checkRedisConnection({ force_connection: true })) !== "ready") {
    throw new Error("REDIS_NOT_READY");
  }

  const poll_ms = getPositiveIntegerEnvironmentVariable(
    "CACHE_OUTBOX_POLL_MS",
    1000,
  );
  let last_cleanup_at = 0;
  console.log(JSON.stringify({ context: "cache_worker_started" }));

  while (!is_stopping) {
    try {
      if (!isWorkShiftCacheEnabled()) {
        await new Promise((resolve) => setTimeout(resolve, poll_ms));
        continue;
      }
      const processed_count = await processOutboxBatch();
      if (Date.now() - last_cleanup_at >= 24 * 60 * 60 * 1000) {
        await cleanupProcessedEvents();
        last_cleanup_at = Date.now();
      }
      if (processed_count === 0) {
        await new Promise((resolve) => setTimeout(resolve, poll_ms));
      }
    } catch (error) {
      logError("cache_worker_batch_failed", error);
      await new Promise((resolve) => setTimeout(resolve, poll_ms));
    }
  }
}

if (require.main === module) {
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  if (process.argv.includes("--healthcheck")) {
    runHealthCheck().catch((error) => {
      logError("cache_worker_healthcheck_failed", error);
      process.exitCode = 1;
    });
  } else {
    runWorker()
      .then(() => shutdown("completed"))
      .catch(async (error) => {
        logError("cache_worker_failed", error);
        await shutdown("failed");
        process.exitCode = 1;
      });
  }
}
