const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

if (process.env.RUN_CACHE_INTEGRATION !== "true") {
  test("Redis/PostgreSQL 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else {
  process.env.NODE_ENV = "test";
  process.env.WORK_SHIFT_CACHE_ENABLED = "true";
  process.env.CACHE_KEY_PREFIX = process.env.CACHE_KEY_PREFIX || "shiftmate:integration";
  process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:56379";
  process.env.REDIS_COMMAND_TIMEOUT_MS = "1000";
  process.env.REDIS_CONNECT_TIMEOUT_MS = "1000";
  process.env.WORK_SHIFT_CACHE_LOCK_MS = "5000";
  process.env.WORK_SHIFT_CACHE_WAIT_MS = "500";

  const { sequelize, connectDatabase, disconnectDatabase } = require("../dist/config/database.js");
  const { getRedisClient, disconnectRedis } = require("../dist/config/redis.js");
  const {
    User,
    ShiftTemplate,
    ShiftTemplateVersion,
    ShiftType,
    ShiftTypeSchedule,
    Friendship,
    FriendLevelSetting,
    WorkShiftMonthState,
    WorkShiftCacheOutbox,
  } = require("../dist/models/index.js");
  const calendarService = require("../dist/services/calendarService.js");
  const calendarController = require("../dist/controllers/calendarController.js");
  const friendService = require("../dist/services/friendService.js");
  const shiftTemplateService = require("../dist/services/shiftTemplateService.js");
  const {
    getWorkShiftRange,
    getWorkShiftCacheKeys,
  } = require("../dist/services/workShiftMonthCacheService.js");
  const {
    cleanupProcessedEvents,
    processOutboxBatch,
  } = require("../dist/workers/workShiftCacheWorker.js");

  let owner;
  let viewer;
  let shift_type;

  test.before(async () => {
    await connectDatabase();
    const schema_sql = fs.readFileSync(
      path.join(__dirname, "fixtures", "cacheIntegrationSchema.sql"),
      "utf8",
    );
    await sequelize.query(schema_sql);
    const redis = await getRedisClient();
    assert.ok(redis?.isReady);
    await redis.flushDb();

    owner = await User.create({
      email: "cache-owner@example.com",
      name: "Cache Owner",
      password: null,
    });
    viewer = await User.create({
      email: "cache-viewer@example.com",
      name: "Cache Viewer",
      password: null,
    });
    const template = await ShiftTemplate.create({
      owner_user_id: owner.user_id,
      name: "Cache Template",
    });
    const version = await ShiftTemplateVersion.create({
      template_id: template.template_id,
      version_no: 1,
      effective_from: new Date("2026-01-01"),
      created_by_user_id: owner.user_id,
    });
    shift_type = await ShiftType.create({
      template_id: template.template_id,
      code: "D",
      name: "Day",
      color: "#FFFFAA00",
      base_color: "#FFFFAA00",
      color_intensity: 100,
      sort_order: 1,
    });
    await ShiftTypeSchedule.create({
      shift_type_id: shift_type.shift_type_id,
      template_version_id: version.template_version_id,
      start_time: "09:00:00",
      end_time: "18:00:00",
      crosses_midnight: false,
      duration_minutes: 540,
    });
  });

  test.after(async () => {
    await disconnectRedis();
    await disconnectDatabase();
  });

  test("월 snapshot hit는 두 번째 work_shifts DB 조회를 생략한다", async () => {
    await calendarService.upsertWorkShift(owner.user_id, "2026-07-03", "D", "first");
    const first = await calendarService.getWorkShifts(
      owner.user_id,
      "2026-07-01",
      "2026-07-31",
    );
    assert.equal(first.length, 1);

    let work_shift_selects = 0;
    const previous_logging = sequelize.options.logging;
    sequelize.options.logging = (sql) => {
      if (/FROM\s+"work_shifts"/i.test(sql)) work_shift_selects += 1;
    };
    const second = await calendarService.getWorkShifts(
      owner.user_id,
      "2026-07-01",
      "2026-07-31",
    );
    sequelize.options.logging = previous_logging;

    assert.deepEqual(second, first);
    assert.equal(work_shift_selects, 0);
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2026-07");
    assert.ok(await redis.get(keys.snapshot_key));
  });

  test("다월 snapshot을 병합한 뒤 요청 기간으로 필터링하고 정렬한다", async () => {
    for (const work_date of [
      "2028-06-01",
      "2028-06-30",
      "2028-07-01",
      "2028-07-31",
      "2028-08-01",
      "2028-08-31",
    ]) {
      await calendarService.upsertWorkShift(owner.user_id, work_date, "D");
    }

    const result = await calendarService.getWorkShifts(
      owner.user_id,
      "2028-06-30",
      "2028-08-01",
    );
    assert.deepEqual(
      result.map((work_shift) => work_shift.work_date),
      ["2028-06-30", "2028-07-01", "2028-07-31", "2028-08-01"],
    );
    assert.ok(
      result.every(
        (work_shift) =>
          typeof work_shift.created_at === "string" &&
          typeof work_shift.updated_at === "string",
      ),
    );

    const redis = await getRedisClient();
    for (const year_month of ["2028-06", "2028-07", "2028-08"]) {
      const keys = getWorkShiftCacheKeys(owner.user_id, year_month);
      const snapshot = JSON.parse(await redis.get(keys.snapshot_key));
      assert.equal(snapshot.work_shifts.length, 2);
    }
  });

  test("calendar range와 day 조회도 공통 월 snapshot을 재사용한다", async () => {
    await calendarService.upsertWorkShift(owner.user_id, "2029-04-10", "D");
    await calendarService.getWorkShifts(
      owner.user_id,
      "2029-04-01",
      "2029-04-30",
    );

    let work_shift_selects = 0;
    const previous_logging = sequelize.options.logging;
    sequelize.options.logging = (sql) => {
      if (/FROM\s+"work_shifts"/i.test(sql)) work_shift_selects += 1;
    };
    try {
      const range = await calendarService.getCalendarRange(
        owner.user_id,
        "2029-04-01",
        "2029-04-30",
      );
      const day = await calendarService.getDaySchedule(
        owner.user_id,
        "2029-04-10",
      );
      assert.deepEqual(
        range.work_shifts.map((work_shift) => work_shift.work_date),
        ["2029-04-10"],
      );
      assert.equal(day.work_shifts.length, 1);
      assert.equal(work_shift_selects, 0);
    } finally {
      sequelize.options.logging = previous_logging;
    }
  });

  test("빈 달도 snapshot으로 저장한다", async () => {
    const result = await calendarService.getWorkShifts(
      owner.user_id,
      "2026-09-01",
      "2026-09-30",
    );
    assert.deepEqual(result, []);
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2026-09");
    const snapshot = JSON.parse(await redis.get(keys.snapshot_key));
    assert.equal(snapshot.revision, "0");
    assert.deepEqual(snapshot.work_shifts, []);
  });

  test("월 DB 로드는 repeatable-read와 PostgreSQL read-only를 함께 설정한다", async () => {
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2029-05");
    await redis.del(keys.snapshot_key, keys.revision_key, keys.lock_key);

    const statements = [];
    const previous_logging = sequelize.options.logging;
    sequelize.options.logging = (sql) => statements.push(sql);
    try {
      await calendarService.getWorkShifts(
        owner.user_id,
        "2029-05-01",
        "2029-05-31",
      );
    } finally {
      sequelize.options.logging = previous_logging;
    }

    assert.ok(
      statements.some((sql) =>
        /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i.test(sql),
      ),
    );
    assert.ok(
      statements.some((sql) => /SET TRANSACTION READ ONLY/i.test(sql)),
    );
  });

  test("손상된 JSON과 schema는 제거하고 DB snapshot으로 복구한다", async () => {
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2026-12");

    await redis.set(keys.snapshot_key, "{broken-json");
    assert.deepEqual(
      await calendarService.getWorkShifts(
        owner.user_id,
        "2026-12-01",
        "2026-12-31",
      ),
      [],
    );
    assert.equal(JSON.parse(await redis.get(keys.snapshot_key)).schema_version, 1);

    await redis.set(
      keys.snapshot_key,
      JSON.stringify({
        schema_version: 1,
        owner_user_id: owner.user_id,
        year_month: "2026-12",
        revision: "0",
        last_modified_at: null,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        work_shifts: [{}],
      }),
    );
    assert.deepEqual(
      await calendarService.getWorkShifts(
        owner.user_id,
        "2026-12-01",
        "2026-12-31",
      ),
      [],
    );
    assert.deepEqual(
      JSON.parse(await redis.get(keys.snapshot_key)).work_shifts,
      [],
    );

    await redis.set(keys.revision_key, "1");
    await redis.set(
      keys.snapshot_key,
      JSON.stringify({
        schema_version: 1,
        owner_user_id: owner.user_id,
        year_month: "2026-12",
        revision: { invalid: true },
        last_modified_at: null,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        work_shifts: [],
      }),
    );
    assert.deepEqual(
      await calendarService.getWorkShifts(
        owner.user_id,
        "2026-12-01",
        "2026-12-31",
      ),
      [],
    );
    assert.equal(await redis.get(keys.snapshot_key), null);
  });

  test("snapshot TTL은 기본값에 설정된 jitter 범위만 추가한다", async () => {
    const previous_ttl = process.env.WORK_SHIFT_CACHE_TTL_SECONDS;
    const previous_jitter = process.env.WORK_SHIFT_CACHE_TTL_JITTER_SECONDS;
    process.env.WORK_SHIFT_CACHE_TTL_SECONDS = "10";
    process.env.WORK_SHIFT_CACHE_TTL_JITTER_SECONDS = "5";

    try {
      await calendarService.getWorkShifts(
        owner.user_id,
        "2027-01-01",
        "2027-01-31",
      );
      const redis = await getRedisClient();
      const keys = getWorkShiftCacheKeys(owner.user_id, "2027-01");
      const snapshot = JSON.parse(await redis.get(keys.snapshot_key));
      const ttl_seconds =
        (Date.parse(snapshot.expires_at) - Date.parse(snapshot.cached_at)) / 1000;
      assert.ok(ttl_seconds >= 10 && ttl_seconds <= 15);
      assert.ok((await redis.ttl(keys.snapshot_key)) <= 15);
    } finally {
      if (previous_ttl === undefined) {
        delete process.env.WORK_SHIFT_CACHE_TTL_SECONDS;
      } else {
        process.env.WORK_SHIFT_CACHE_TTL_SECONDS = previous_ttl;
      }
      if (previous_jitter === undefined) {
        delete process.env.WORK_SHIFT_CACHE_TTL_JITTER_SECONDS;
      } else {
        process.env.WORK_SHIFT_CACHE_TTL_JITTER_SECONDS = previous_jitter;
      }
    }
  });

  test("배치 변경은 고유 월마다 revision과 Outbox를 한 번 기록한다", async () => {
    await calendarService.batchUpsertWorkShifts(owner.user_id, [
      { work_date: "2026-07-04", shift_type_code: "D" },
      { work_date: "2026-07-05", shift_type_code: "D" },
      { work_date: "2026-08-01", shift_type_code: "D" },
    ]);
    const july = await WorkShiftMonthState.findOne({
      where: { owner_user_id: owner.user_id, year_month: "2026-07-01" },
    });
    const august = await WorkShiftMonthState.findOne({
      where: { owner_user_id: owner.user_id, year_month: "2026-08-01" },
    });
    assert.equal(july.revision, "2");
    assert.equal(august.revision, "1");

    const july_events = await WorkShiftCacheOutbox.count({
      where: { owner_user_id: owner.user_id, year_month: "2026-07-01" },
    });
    assert.equal(july_events, 2);
  });

  test("실패한 batch transaction은 근무표·state·Outbox를 남기지 않는다", async () => {
    await assert.rejects(
      calendarService.batchUpsertWorkShifts(owner.user_id, [
        { work_date: "2026-10-01", shift_type_code: "D" },
        { work_date: "2026-10-02", shift_type_code: "INVALID" },
      ]),
      /INVALID_SHIFT_TYPE/,
    );
    const rows = await calendarService.loadWorkShiftsFromDatabase(
      owner.user_id,
      "2026-10-01",
      "2026-10-31",
    );
    assert.deepEqual(rows, []);
    assert.equal(
      await WorkShiftMonthState.count({
        where: { owner_user_id: owner.user_id, year_month: "2026-10-01" },
      }),
      0,
    );
  });

  test("템플릿명·미사용 타입은 무효화하지 않고 자정 넘김은 work_date 월만 갱신한다", async () => {
    const outbox_before = await WorkShiftCacheOutbox.count();
    await shiftTemplateService.updateTemplateName(
      owner.user_id,
      "Cache Template Renamed",
    );
    const unused_type = await shiftTemplateService.createShiftType(owner.user_id, {
      code: "U",
      name: "Unused",
      start_time: null,
      end_time: null,
    });
    await shiftTemplateService.updateShiftType(
      owner.user_id,
      unused_type.shift_type_id,
      { name: "Unused Renamed", sort_order: 9 },
    );
    assert.equal(await WorkShiftCacheOutbox.count(), outbox_before);

    const night_type = await shiftTemplateService.createShiftType(owner.user_id, {
      code: "N",
      name: "Night",
      start_time: "22:00:00",
      end_time: "06:00:00",
    });
    assert.equal(night_type.crosses_midnight, true);
    await calendarService.upsertWorkShift(owner.user_id, "2029-02-28", "N");
    await shiftTemplateService.updateShiftType(
      owner.user_id,
      night_type.shift_type_id,
      { start_time: "23:00:00", end_time: "07:00:00" },
    );

    const february = await WorkShiftMonthState.findOne({
      where: { owner_user_id: owner.user_id, year_month: "2029-02-01" },
    });
    assert.equal(february.revision, "2");
    assert.equal(
      await WorkShiftCacheOutbox.count({
        where: { owner_user_id: owner.user_id, year_month: "2029-02-01" },
      }),
      2,
    );
    assert.equal(
      await WorkShiftMonthState.count({
        where: { owner_user_id: owner.user_id, year_month: "2029-03-01" },
      }),
      0,
    );
    const [night_shift] = await calendarService.getWorkShifts(
      owner.user_id,
      "2029-02-28",
      "2029-02-28",
    );
    assert.equal(night_shift.start_time, "23:00:00");
    assert.equal(night_shift.end_time, "07:00:00");
  });

  test("단건 생성·수정·삭제는 각각 revision과 Outbox를 정확히 한 번 기록한다", async () => {
    const work_shift = await calendarService.upsertWorkShift(
      owner.user_id,
      "2028-09-14",
      "D",
      "created",
    );
    const month_where = {
      owner_user_id: owner.user_id,
      year_month: "2028-09-01",
    };
    let month_state = await WorkShiftMonthState.findOne({ where: month_where });
    assert.equal(month_state.revision, "1");
    assert.equal(await WorkShiftCacheOutbox.count({ where: month_where }), 1);

    await assert.rejects(
      calendarService.updateWorkShift(
        owner.user_id,
        work_shift.work_shift_id,
        "INVALID",
      ),
      /SHIFT_TYPE_NOT_FOUND/,
    );
    month_state = await WorkShiftMonthState.findOne({ where: month_where });
    assert.equal(month_state.revision, "1");
    assert.equal(await WorkShiftCacheOutbox.count({ where: month_where }), 1);

    await calendarService.updateWorkShift(
      owner.user_id,
      work_shift.work_shift_id,
      undefined,
      "updated",
    );
    month_state = await WorkShiftMonthState.findOne({ where: month_where });
    assert.equal(month_state.revision, "2");
    assert.equal(await WorkShiftCacheOutbox.count({ where: month_where }), 2);
    assert.equal(
      (
        await calendarService.getWorkShifts(
          owner.user_id,
          "2028-09-01",
          "2028-09-30",
        )
      )[0].note,
      "updated",
    );

    await calendarService.deleteWorkShift(owner.user_id, work_shift.work_shift_id);
    month_state = await WorkShiftMonthState.findOne({ where: month_where });
    assert.equal(month_state.revision, "3");
    assert.equal(await WorkShiftCacheOutbox.count({ where: month_where }), 3);
    assert.deepEqual(
      await calendarService.getWorkShifts(
        owner.user_id,
        "2028-09-01",
        "2028-09-30",
      ),
      [],
    );

    await assert.rejects(
      calendarService.deleteWorkShift(owner.user_id, work_shift.work_shift_id),
      /WORK_SHIFT_NOT_FOUND/,
    );
    assert.equal(await WorkShiftCacheOutbox.count({ where: month_where }), 3);
  });

  test("근무 타입 표시값 변경은 실제 참조 월만 무효화한다", async () => {
    await calendarService.upsertWorkShift(owner.user_id, "2026-10-03", "D");
    await calendarService.getWorkShifts(
      owner.user_id,
      "2026-10-01",
      "2026-10-31",
    );
    const redis = await getRedisClient();
    const october_keys = getWorkShiftCacheKeys(owner.user_id, "2026-10");
    assert.ok(await redis.get(october_keys.snapshot_key));

    await shiftTemplateService.updateShiftType(owner.user_id, shift_type.shift_type_id, {
      sort_order: 2,
    });
    const after_sort = await WorkShiftMonthState.findOne({
      where: { owner_user_id: owner.user_id, year_month: "2026-10-01" },
    });
    assert.equal(after_sort.revision, "1");
    assert.ok(await redis.get(october_keys.snapshot_key));

    await shiftTemplateService.updateShiftType(owner.user_id, shift_type.shift_type_id, {
      name: "Day Updated",
    });
    const after_name = await WorkShiftMonthState.findOne({
      where: { owner_user_id: owner.user_id, year_month: "2026-10-01" },
    });
    assert.equal(after_name.revision, "2");
    assert.equal(await redis.get(october_keys.snapshot_key), null);
    assert.equal(
      (
        await calendarService.getWorkShifts(
          owner.user_id,
          "2026-10-01",
          "2026-10-31",
        )
      )[0].shift_type_name,
      "Day Updated",
    );
    assert.equal(
      await WorkShiftMonthState.count({
        where: { owner_user_id: owner.user_id, year_month: "2026-09-01" },
      }),
      0,
    );
  });

  test("revision fence는 오래된 snapshot 재저장을 차단한다", async () => {
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2026-11");
    await redis.set(keys.revision_key, "99");
    const result = await calendarService.getWorkShifts(
      owner.user_id,
      "2026-11-01",
      "2026-11-30",
    );
    assert.deepEqual(result, []);
    assert.equal(await redis.get(keys.snapshot_key), null);
  });

  test("동시 cache miss는 token lock으로 월 DB 로드를 한 번만 수행한다", async () => {
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2028-10");
    await redis.del(keys.snapshot_key, keys.revision_key, keys.lock_key);
    let load_count = 0;
    const loader = async (start_date, end_date, transaction) => {
      load_count += 1;
      const rows = await calendarService.loadWorkShiftsFromDatabase(
        owner.user_id,
        start_date,
        end_date,
        transaction,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      return rows;
    };
    const range_loader = (start_date, end_date, transaction) =>
      calendarService.loadWorkShiftsFromDatabase(
        owner.user_id,
        start_date,
        end_date,
        transaction,
      );

    const results = await Promise.all([
      getWorkShiftRange(
        owner.user_id,
        "2028-10-01",
        "2028-10-31",
        loader,
        range_loader,
      ),
      getWorkShiftRange(
        owner.user_id,
        "2028-10-01",
        "2028-10-31",
        loader,
        range_loader,
      ),
    ]);
    assert.equal(load_count, 1);
    assert.deepEqual(
      results.map((result) => result.cache_result).sort(),
      ["hit", "miss"],
    );
  });

  test("lock 미획득 요청은 대기 후 DB fallback하고 snapshot을 덮어쓰지 않는다", async () => {
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2028-11");
    await redis.del(keys.snapshot_key, keys.revision_key, keys.lock_key);
    await redis.set(keys.lock_key, "another-loader", { PX: 2_000 });
    const started_at = Date.now();
    const result = await calendarService.getWorkShiftsWithCacheMetadata(
      owner.user_id,
      "2028-11-01",
      "2028-11-30",
    );
    assert.deepEqual(result.work_shifts, []);
    assert.equal(result.cache_result, "miss");
    assert.ok(Date.now() - started_at >= 450);
    assert.equal(await redis.get(keys.snapshot_key), null);
    await redis.del(keys.lock_key);
  });

  test("조회와 쓰기 경합에서 repeatable-read의 오래된 snapshot 저장을 fence가 차단한다", async () => {
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2028-12");
    await redis.del(keys.snapshot_key, keys.revision_key, keys.lock_key);

    let notify_loaded;
    const loaded = new Promise((resolve) => {
      notify_loaded = resolve;
    });
    let release_loader;
    const loader_release = new Promise((resolve) => {
      release_loader = resolve;
    });
    const racing_loader = async (start_date, end_date, transaction) => {
      const rows = await calendarService.loadWorkShiftsFromDatabase(
        owner.user_id,
        start_date,
        end_date,
        transaction,
      );
      notify_loaded();
      await loader_release;
      return rows;
    };
    const range_loader = (start_date, end_date, transaction) =>
      calendarService.loadWorkShiftsFromDatabase(
        owner.user_id,
        start_date,
        end_date,
        transaction,
      );

    const stale_read = getWorkShiftRange(
      owner.user_id,
      "2028-12-01",
      "2028-12-31",
      racing_loader,
      range_loader,
    );
    await loaded;
    await calendarService.upsertWorkShift(owner.user_id, "2028-12-08", "D");
    release_loader();

    assert.deepEqual((await stale_read).work_shifts, []);
    assert.equal(await redis.get(keys.snapshot_key), null);
    assert.equal(await redis.get(keys.revision_key), "1");
    assert.deepEqual(
      (
        await calendarService.getWorkShifts(
          owner.user_id,
          "2028-12-01",
          "2028-12-31",
        )
      ).map((work_shift) => work_shift.work_date),
      ["2028-12-08"],
    );
  });

  test("친구 권한은 cache hit와 무관하게 매 요청 다시 확인한다", async () => {
    const { user_id_a, user_id_b } = Friendship.sortUserIds(
      owner.user_id,
      viewer.user_id,
    );
    await Friendship.create({ user_id_a, user_id_b });
    await FriendLevelSetting.bulkCreate([
      {
        owner_user_id: owner.user_id,
        friend_user_id: viewer.user_id,
        can_view: true,
        friend_level: 0,
      },
      {
        owner_user_id: viewer.user_id,
        friend_user_id: owner.user_id,
        can_view: true,
        friend_level: 0,
      },
    ]);
    const visible = await friendService.getFriendCalendarRange(
      viewer.user_id,
      owner.user_id,
      "2026-07-01",
      "2026-07-31",
    );
    assert.ok(visible.work_shifts.length >= 1);

    await friendService.updateFriendSettings(owner.user_id, viewer.user_id, {
      can_view: false,
    });
    await assert.rejects(
      friendService.getFriendCalendarRange(
        viewer.user_id,
        owner.user_id,
        "2026-07-01",
        "2026-07-31",
      ),
      /CALENDAR_ACCESS_DENIED/,
    );

    await friendService.updateFriendSettings(owner.user_id, viewer.user_id, {
      can_view: true,
    });
    assert.ok(
      (
        await friendService.getFriendCalendarRange(
          viewer.user_id,
          owner.user_id,
          "2026-07-01",
          "2026-07-31",
        )
      ).work_shifts.length >= 1,
    );
    await friendService.deleteFriend(viewer.user_id, owner.user_id);
    await assert.rejects(
      friendService.getFriendCalendarRange(
        viewer.user_id,
        owner.user_id,
        "2026-07-01",
        "2026-07-31",
      ),
      /FRIEND_NOT_FOUND/,
    );
  });

  test("work-shifts ETag는 304와 변경 후 새 200 응답을 만든다", async () => {
    const createResponse = () => ({
      status_code: 200,
      headers: {},
      body: null,
      ended: false,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
        return this;
      },
      status(value) {
        this.status_code = value;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
      end() {
        this.ended = true;
        return this;
      },
    });
    const request = {
      user: { user_id: owner.user_id },
      query: { start_date: "2027-02-01", end_date: "2027-02-28" },
      headers: {},
      request_id: "etag-integration-test",
    };

    const first_response = createResponse();
    await calendarController.getWorkShifts(request, first_response);
    assert.equal(first_response.status_code, 200);
    assert.equal(first_response.headers["cache-control"], "private, no-cache");
    const first_etag = first_response.headers.etag;
    assert.ok(first_etag);

    const second_response = createResponse();
    await calendarController.getWorkShifts(
      { ...request, headers: { "if-none-match": first_etag } },
      second_response,
    );
    assert.equal(second_response.status_code, 304);
    assert.equal(second_response.body, null);
    assert.equal(second_response.ended, true);

    await calendarService.upsertWorkShift(owner.user_id, "2027-02-12", "D");
    const changed_response = createResponse();
    await calendarController.getWorkShifts(
      { ...request, headers: { "if-none-match": first_etag } },
      changed_response,
    );
    assert.equal(changed_response.status_code, 200);
    assert.notEqual(changed_response.headers.etag, first_etag);
    assert.equal(changed_response.body.data.work_shifts.length, 1);
  });

  test("Redis 장애 중 쓰기는 DB에 commit되고 복구 후 Outbox가 재처리된다", async () => {
    const previous_redis_url = process.env.REDIS_URL;
    await disconnectRedis();
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    let outage_event;
    try {
      await calendarService.upsertWorkShift(owner.user_id, "2027-03-07", "D");
      outage_event = await WorkShiftCacheOutbox.findOne({
        where: {
          owner_user_id: owner.user_id,
          year_month: "2027-03-01",
          processed_at: null,
        },
        order: [["created_at", "DESC"]],
      });
      assert.ok(outage_event);
      const result = await calendarService.getWorkShifts(
        owner.user_id,
        "2027-03-01",
        "2027-03-31",
      );
      assert.equal(result.length, 1);
      assert.equal(result[0].work_date, "2027-03-07");
    } finally {
      process.env.REDIS_URL = previous_redis_url;
      assert.ok((await getRedisClient())?.isReady);
    }

    while ((await processOutboxBatch()) > 0) {}
    await outage_event.reload();
    assert.ok(outage_event.processed_at);
    const redis = await getRedisClient();
    const keys = getWorkShiftCacheKeys(owner.user_id, "2027-03");
    assert.equal(await redis.get(keys.revision_key), "1");
    assert.equal(
      (
        await calendarService.getWorkShifts(
          owner.user_id,
          "2027-03-01",
          "2027-03-31",
        )
      ).length,
      1,
    );
    assert.ok(await redis.get(keys.snapshot_key));
  });

  test("Outbox worker는 미처리 이벤트를 멱등 처리한다", async () => {
    await WorkShiftCacheOutbox.create({
      owner_user_id: owner.user_id,
      year_month: "2027-06-01",
      revision: "1",
    });
    const before = await WorkShiftCacheOutbox.count({
      where: { processed_at: null },
    });
    assert.ok(before > 0);
    while ((await processOutboxBatch()) > 0) {}
    assert.equal(
      await WorkShiftCacheOutbox.count({ where: { processed_at: null } }),
      0,
    );
    assert.equal(await processOutboxBatch(), 0);
  });

  test("Outbox worker는 stale claim 회수와 Redis 실패 재시도를 수행한다", async () => {
    const stale_event = await WorkShiftCacheOutbox.create({
      owner_user_id: owner.user_id,
      year_month: "2027-04-01",
      revision: "1",
      claimed_at: new Date(Date.now() - 61_000),
      claim_token: crypto.randomUUID(),
    });
    assert.equal(await processOutboxBatch(), 1);
    await stale_event.reload();
    assert.ok(stale_event.processed_at);

    const retry_event = await WorkShiftCacheOutbox.create({
      owner_user_id: owner.user_id,
      year_month: "2027-05-01",
      revision: "1",
    });
    const capped_retry_event = await WorkShiftCacheOutbox.create({
      owner_user_id: owner.user_id,
      year_month: "2027-07-01",
      revision: "1",
      attempt_count: 7,
    });
    const previous_redis_url = process.env.REDIS_URL;
    await disconnectRedis();
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    try {
      assert.equal(await processOutboxBatch(), 2);
    } finally {
      process.env.REDIS_URL = previous_redis_url;
      assert.ok((await getRedisClient())?.isReady);
    }

    await retry_event.reload();
    assert.equal(retry_event.processed_at, null);
    assert.equal(retry_event.attempt_count, 1);
    assert.equal(retry_event.last_error_code, "REDIS_INVALIDATION_FAILED");
    assert.ok(retry_event.next_attempt_at > retry_event.created_at);
    await capped_retry_event.reload();
    assert.equal(capped_retry_event.processed_at, null);
    assert.equal(capped_retry_event.attempt_count, 8);
    assert.equal(
      capped_retry_event.last_error_code,
      "REDIS_INVALIDATION_FAILED",
    );
    const capped_delay_seconds =
      (capped_retry_event.next_attempt_at.getTime() - Date.now()) / 1000;
    assert.ok(capped_delay_seconds >= 55 && capped_delay_seconds <= 60);

    retry_event.next_attempt_at = new Date(Date.now() - 1_000);
    capped_retry_event.next_attempt_at = new Date(Date.now() - 1_000);
    await retry_event.save();
    await capped_retry_event.save();
    assert.equal(await processOutboxBatch(), 2);
    await retry_event.reload();
    await capped_retry_event.reload();
    assert.ok(retry_event.processed_at);
    assert.ok(capped_retry_event.processed_at);
  });

  test("동시에 실행된 worker는 row lock으로 서로 다른 Outbox를 claim한다", async () => {
    const previous_batch_size = process.env.CACHE_OUTBOX_BATCH_SIZE;
    process.env.CACHE_OUTBOX_BATCH_SIZE = "5";
    try {
      await WorkShiftCacheOutbox.bulkCreate(
        Array.from({ length: 10 }, (_value, index) => ({
          owner_user_id: owner.user_id,
          year_month: "2029-01-01",
          revision: String(index + 1),
        })),
      );
      const processed_counts = await Promise.all([
        processOutboxBatch(),
        processOutboxBatch(),
      ]);
      assert.deepEqual(processed_counts.sort((left, right) => left - right), [5, 5]);

      const events = await WorkShiftCacheOutbox.findAll({
        where: {
          owner_user_id: owner.user_id,
          year_month: "2029-01-01",
        },
      });
      assert.equal(events.length, 10);
      assert.ok(events.every((event) => event.processed_at !== null));
      assert.ok(events.every((event) => event.attempt_count === 1));
      const redis = await getRedisClient();
      const keys = getWorkShiftCacheKeys(owner.user_id, "2029-01");
      assert.equal(await redis.get(keys.revision_key), "10");
    } finally {
      if (previous_batch_size === undefined) {
        delete process.env.CACHE_OUTBOX_BATCH_SIZE;
      } else {
        process.env.CACHE_OUTBOX_BATCH_SIZE = previous_batch_size;
      }
    }
  });

  test("worker 정리는 처리 완료 후 7일이 지난 Outbox만 삭제한다", async () => {
    const old_event = await WorkShiftCacheOutbox.create({
      owner_user_id: owner.user_id,
      year_month: "2029-05-01",
      revision: "1",
      processed_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const recent_event = await WorkShiftCacheOutbox.create({
      owner_user_id: owner.user_id,
      year_month: "2029-06-01",
      revision: "1",
      processed_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    });

    await cleanupProcessedEvents();
    assert.equal(await WorkShiftCacheOutbox.count({ where: { event_id: old_event.event_id } }), 0);
    assert.equal(
      await WorkShiftCacheOutbox.count({
        where: { event_id: recent_event.event_id },
      }),
      1,
    );
  });
}
