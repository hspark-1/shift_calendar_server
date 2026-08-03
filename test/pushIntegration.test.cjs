const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const reset_allowed = process.env.PUSH_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const is_isolated_database =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

if (process.env.RUN_PUSH_INTEGRATION !== "true") {
  test("Push PostgreSQL 16 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else if (!reset_allowed || !is_isolated_database) {
  test("Push 통합 테스트는 고정된 격리 DB에서만 public schema를 초기화한다", () => {
    assert.fail(
      "PUSH_INTEGRATION_ALLOW_SCHEMA_RESET=true와 127.0.0.1:55432/shift_calendar_group_debug/group_debug 연결이 필요합니다.",
    );
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.PUSH_APP_ENVIRONMENT = "STAGE";
  process.env.PUSH_JOB_ENQUEUE_ENABLED = "true";
  process.env.PUSH_WORKER_ENABLED = "true";
  process.env.PUSH_JOB_BATCH_SIZE = "20";
  process.env.PUSH_JOB_LEASE_SECONDS = "1";
  process.env.PUSH_MAX_ATTEMPTS = "6";
  process.env.PUSH_JOB_TTL_SECONDS = "3600";
  process.env.INSTANCE_NAME = "push-integration";

  const { Op, QueryTypes } = require("sequelize");
  const {
    connectDatabase,
    disconnectDatabase,
    sequelize,
  } = require("../dist/config/database.js");
  const {
    Notification,
    PushDelivery,
    PushJob,
    User,
    UserDevice,
  } = require("../dist/models/index.js");
  const {
    disableDeviceTarget,
    unbindAllUserDevices,
    unbindDeviceForLogout,
    upsertCurrentDevice,
  } = require("../dist/services/deviceService.js");
  const {
    createNotificationWithPushJob,
  } = require("../dist/services/notificationService.js");
  const { processPushBatch } = require("../dist/workers/pushWorker.js");

  const root = path.join(__dirname, "..");
  let first_user;
  let second_user;

  async function createNotification(user_id, title = "통합 테스트 알림") {
    return sequelize.transaction((transaction) =>
      createNotificationWithPushJob(
        {
          user_id,
          notification_type: "FRIEND_REQUEST",
          title,
          body: "본문 snapshot",
          payload: { request_id: "request-fixture" },
          actions: [{ type: "accept", label: "수락" }],
        },
        transaction,
      ),
    );
  }

  function successProvider(seen_messages) {
    return {
      async sendBatch(messages) {
        seen_messages.push(...messages);
        return messages.map((_, index) => ({
          success: true,
          provider_message_id: `provider-${index}`,
        }));
      },
      async checkReady() {},
    };
  }

  test.before(async () => {
    await connectDatabase();
    await sequelize.query(
      fs.readFileSync(
        path.join(__dirname, "fixtures", "pushIntegrationBaseSchema.sql"),
        "utf8",
      ),
    );
    first_user = await User.create({
      email: "push-first@example.com",
      name: "Push First",
    });
    second_user = await User.create({
      email: "push-second@example.com",
      name: "Push Second",
    });
    await Notification.create({
      user_id: first_user.user_id,
      notification_type: "SYSTEM",
      title: "migration 이전 알림",
    });
    await sequelize.query(
      fs.readFileSync(
        path.join(root, "migrations", "add_push_notification_support.sql"),
        "utf8",
      ),
    );
  });

  test.after(async () => {
    await disconnectDatabase();
  });

  test.beforeEach(async () => {
    await PushDelivery.destroy({ where: {}, truncate: true, cascade: true });
    await PushJob.destroy({ where: {}, truncate: true, cascade: true });
    await UserDevice.destroy({ where: {}, truncate: true, cascade: true });
    await Notification.destroy({
      where: { notification_type: { [Op.ne]: "SYSTEM" } },
    });
  });

  test("migration은 기존 알림을 backfill하지 않고 핵심 제약과 인덱스를 만든다", async () => {
    assert.equal(await PushJob.count(), 0);
    const indexes = await sequelize.query(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'uq_user_devices_environment_installation',
            'uq_user_devices_environment_target',
            'idx_user_devices_latest_active',
            'idx_push_jobs_claimable',
            'idx_push_jobs_lease'
          )
        ORDER BY indexname
      `,
      { type: QueryTypes.SELECT },
    );
    assert.equal(indexes.length, 5);
  });

  test("기기 upsert는 멱등이고 같은 환경 target을 최신 설치에 재귀속한다", async () => {
    const installation_id = "00000000-0000-4000-8000-000000000001";
    const first = await upsertCurrentDevice(first_user.user_id, {
      installation_id,
      platform: "IOS",
      provider_target: "shared-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    const repeated = await upsertCurrentDevice(first_user.user_id, {
      installation_id,
      platform: "IOS",
      provider_target: "shared-target",
      push_permission_enabled: true,
      app_version: "1.0.0+2",
    });
    assert.equal(repeated.device_id, first.device_id);
    assert.equal(await UserDevice.count(), 1);

    const reassigned = await upsertCurrentDevice(second_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000002",
      platform: "ANDROID",
      provider_target: "shared-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    await first.reload();
    assert.equal(first.provider_target, null);
    assert.equal(first.is_active, false);
    assert.equal(first.disabled_reason, "TARGET_REASSIGNED");
    assert.equal(reassigned.provider_target, "shared-target");
  });

  test("알림과 job은 같은 transaction에서 생성되고 rollback도 함께 된다", async () => {
    const notification = await createNotification(first_user.user_id);
    const job = await PushJob.findOne({
      where: { notification_id: notification.notification_id },
    });
    assert.ok(job);
    assert.equal(job.title, "통합 테스트 알림");
    assert.deepEqual(job.data_payload, {
      schema_version: "1",
      notification_id: notification.notification_id,
      notification_type: "FRIEND_REQUEST",
      destination: "NOTIFICATIONS",
    });

    await assert.rejects(
      sequelize.transaction(async (transaction) => {
        await createNotificationWithPushJob(
          {
            user_id: first_user.user_id,
            notification_type: "FRIEND_REQUEST",
            title: "rollback-marker",
          },
          transaction,
        );
        throw new Error("FORCED_ROLLBACK");
      }),
      /FORCED_ROLLBACK/,
    );
    assert.equal(await Notification.count({ where: { title: "rollback-marker" } }), 0);
    assert.equal(await PushJob.count({ where: { title: "rollback-marker" } }), 0);
  });

  test("worker는 최신 활성 기기 한 대를 고정하고 token refresh를 재시도에 반영한다", async () => {
    const older = await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000011",
      platform: "ANDROID",
      provider_target: "older-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    const newer = await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000012",
      platform: "IOS",
      provider_target: "newer-target-v1",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    await older.update({ last_seen_at: new Date("2026-01-01T00:00:00Z") });
    await newer.update({ last_seen_at: new Date("2026-01-02T00:00:00Z") });
    await createNotification(first_user.user_id);

    const first_messages = [];
    await processPushBatch({
      async sendBatch(messages) {
        first_messages.push(...messages);
        return messages.map(() => ({
          success: false,
          error_code: "messaging/server-unavailable",
        }));
      },
      async checkReady() {},
    });
    assert.equal(first_messages.length, 1);
    assert.equal(first_messages[0].provider_target, "newer-target-v1");
    const delivery = await PushDelivery.findOne();
    assert.equal(delivery.device_id, newer.device_id);

    await upsertCurrentDevice(first_user.user_id, {
      installation_id: newer.installation_id,
      platform: "IOS",
      provider_target: "newer-target-v2",
      push_permission_enabled: true,
      app_version: "1.0.0+2",
    });
    await PushJob.update({ available_at: new Date(0) }, { where: { status: "RETRY" } });
    const retry_messages = [];
    await processPushBatch(successProvider(retry_messages));
    assert.equal(retry_messages[0].provider_target, "newer-target-v2");
    await delivery.reload();
    assert.equal(delivery.status, "SENT");
    assert.equal(delivery.device_id, newer.device_id);
  });

  test("선택 기기 해제 시 같은 job은 차순위 기기로 fallback하지 않는다", async () => {
    const older = await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000021",
      platform: "ANDROID",
      provider_target: "fallback-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    const selected = await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000022",
      platform: "IOS",
      provider_target: "selected-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    await older.update({ last_seen_at: new Date("2026-01-01T00:00:00Z") });
    await selected.update({ last_seen_at: new Date("2026-01-02T00:00:00Z") });
    await createNotification(first_user.user_id);
    await processPushBatch({
      async sendBatch(messages) {
        return messages.map(() => ({
          success: false,
          error_code: "messaging/server-unavailable",
        }));
      },
      async checkReady() {},
    });
    await disableDeviceTarget(selected.device_id, "LOGOUT");
    await PushJob.update({ available_at: new Date(0) }, { where: { status: "RETRY" } });
    const messages = [];
    await processPushBatch(successProvider(messages));
    assert.equal(messages.length, 0);
    const job = await PushJob.findOne();
    assert.equal(job.status, "NO_TARGET");
    const delivery = await PushDelivery.findOne();
    assert.equal(delivery.device_id, selected.device_id);
    assert.notEqual(delivery.device_id, older.device_id);
  });

  test("동시 worker claim은 job을 중복 전송하지 않고 만료 lease를 회수한다", async () => {
    await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000025",
      platform: "ANDROID",
      provider_target: "concurrent-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    const first_notification = await createNotification(
      first_user.user_id,
      "concurrent-first",
    );
    const second_notification = await createNotification(
      first_user.user_id,
      "concurrent-second",
    );
    const sent_ids = [];
    const provider = {
      async sendBatch(messages) {
        sent_ids.push(...messages.map((message) => message.notification_id));
        await new Promise((resolve) => setTimeout(resolve, 20));
        return messages.map(() => ({ success: true }));
      },
      async checkReady() {},
    };
    await Promise.all([processPushBatch(provider), processPushBatch(provider)]);
    assert.equal(sent_ids.length, 2);
    assert.equal(new Set(sent_ids).size, 2);
    assert.deepEqual(
      new Set(sent_ids),
      new Set([
        first_notification.notification_id,
        second_notification.notification_id,
      ]),
    );

    const lease_notification = await createNotification(
      first_user.user_id,
      "expired-lease",
    );
    await PushJob.update(
      {
        status: "PROCESSING",
        locked_by: "crashed-worker",
        lease_until: new Date(Date.now() - 1_000),
      },
      { where: { notification_id: lease_notification.notification_id } },
    );
    const recovered_messages = [];
    await processPushBatch(successProvider(recovered_messages));
    assert.equal(recovered_messages.length, 1);
    const recovered_job = await PushJob.findOne({
      where: { notification_id: lease_notification.notification_id },
    });
    assert.equal(recovered_job.status, "COMPLETED");
  });

  test("영구 target 오류와 logout/logout-all은 기기를 비활성화한다", async () => {
    const first = await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000031",
      platform: "IOS",
      provider_target: "permanent-error-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    await createNotification(first_user.user_id);
    await processPushBatch({
      async sendBatch(messages) {
        return messages.map(() => ({
          success: false,
          error_code: "messaging/registration-token-not-registered",
        }));
      },
      async checkReady() {},
    });
    await first.reload();
    assert.equal(first.is_active, false);
    assert.equal(first.provider_target, null);

    const second = await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000032",
      platform: "ANDROID",
      provider_target: "logout-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    await sequelize.transaction((transaction) =>
      unbindDeviceForLogout(first_user.user_id, second.installation_id, transaction),
    );
    await second.reload();
    assert.equal(second.user_id, null);
    assert.equal(second.disabled_reason, "LOGOUT");

    await upsertCurrentDevice(first_user.user_id, {
      installation_id: "00000000-0000-4000-8000-000000000033",
      platform: "ANDROID",
      provider_target: "logout-all-target",
      push_permission_enabled: true,
      app_version: "1.0.0+1",
    });
    await sequelize.transaction((transaction) =>
      unbindAllUserDevices(first_user.user_id, transaction),
    );
    assert.equal(
      await UserDevice.count({ where: { user_id: first_user.user_id } }),
      0,
    );
  });
}
