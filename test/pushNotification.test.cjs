const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  calculateRetryDelayMs,
  isPermanentTargetError,
} = require("../dist/workers/pushWorker.js");

test("푸시 retry는 10초 지수 backoff, jitter, 15분 상한을 적용한다", () => {
  assert.equal(calculateRetryDelayMs(1, undefined, 0.5), 10_000);
  assert.equal(calculateRetryDelayMs(2, undefined, 0.5), 20_000);
  assert.equal(calculateRetryDelayMs(20, undefined, 0.5), 900_000);
  assert.equal(calculateRetryDelayMs(1, 37, 0), 37_000);
  assert.equal(calculateRetryDelayMs(1, 3_600, 0), 900_000);
  assert.equal(calculateRetryDelayMs(1, undefined, 0), 8_000);
  assert.equal(calculateRetryDelayMs(1, undefined, 1), 12_000);
});

test("영구 target 오류만 기기 비활성화 대상으로 분류한다", () => {
  assert.equal(
    isPermanentTargetError("messaging/registration-token-not-registered"),
    true,
  );
  assert.equal(isPermanentTargetError("messaging/invalid-argument"), true);
  assert.equal(isPermanentTargetError("messaging/server-unavailable"), false);
});

test("push migration은 최신 기기, lease, 단일 delivery 계약을 포함한다", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "add_push_notification_support.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_devices/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_jobs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS push_deliveries/);
  assert.match(migration, /idx_user_devices_latest_active/);
  assert.match(migration, /uq_push_deliveries_job UNIQUE/);
  assert.match(migration, /ck_push_jobs_lock_pair/);
  assert.doesNotMatch(migration, /INSERT INTO push_jobs/);
});

test("기기 OpenAPI 응답에는 provider target이 없다", () => {
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "src", "openapi", "deviceOpenApi.json"),
      "utf8",
    ),
  );
  const response_properties =
    spec.components.schemas.CurrentDeviceResponse.properties.data.properties;
  assert.equal("provider_target" in response_properties, false);
  assert.equal(
    spec.components.schemas.CurrentDeviceRequest.properties.provider_target.writeOnly,
    true,
  );
});

test("worker는 만료 lease의 취소·TTL·최대 시도를 terminal 상태로 회수한다", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "src", "workers", "pushWorker.ts"),
    "utf8",
  );
  assert.match(worker, /status <> 'PROCESSING' OR lease_until <= now\(\)/);
  assert.match(worker, /MAX_ATTEMPTS_EXCEEDED/);
  assert.match(worker, /delivery\.status IN \('PENDING', 'SENDING', 'RETRY'\)/);
});
