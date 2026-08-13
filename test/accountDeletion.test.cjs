const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

const {
  calculateAccountDeletionRetryDelayMs,
} = require("../dist/workers/accountDeletionWorker.js");

test("회원 탈퇴 retry는 10초 지수 backoff, jitter, 1시간 상한을 적용한다", () => {
  assert.equal(calculateAccountDeletionRetryDelayMs(1, 0), 8_000);
  assert.equal(calculateAccountDeletionRetryDelayMs(1, 1), 12_000);
  assert.equal(calculateAccountDeletionRetryDelayMs(20, 0.5), 3_600_000);
});

test("공개 API는 명시적 boolean 확인과 탈퇴 중 상태 조회를 제공한다", () => {
  const routes = readRepositoryFile("src/routes/authRoutes.ts");
  const openapi = JSON.parse(
    readRepositoryFile("src/openapi/accountDeletionOpenApi.json"),
  );
  assert.match(routes, /router\.delete\(\s*"\/account"/);
  assert.match(routes, /req\.body\?\.confirmation === true/);
  assert.match(routes, /ACCOUNT_DELETION_CONFIRMATION_REQUIRED/);
  assert.match(routes, /router\.get\(\s*"\/account-deletion"/);
  assert.deepEqual(
    openapi.components.schemas.AccountDeletionRequest.properties.confirmation.enum,
    [true],
  );
  assert.ok(openapi.paths["/auth/account"].delete.responses["202"]);
});

test("JWT auth_time과 DELETION_PENDING 즉시 차단 계약을 고정한다", () => {
  const auth_service = readRepositoryFile("src/services/authService.ts");
  const auth_middleware = readRepositoryFile("src/middlewares/auth.ts");
  assert.match(auth_service, /auth_time/);
  assert.match(auth_service, /ACCOUNT_DELETION_IN_PROGRESS/);
  assert.match(auth_middleware, /user\.account_status !== "ACTIVE"/);
  assert.match(auth_middleware, /user\.account_status !== "DELETION_PENDING"/);
  assert.match(auth_middleware, /accountDeletionStatusAuthMiddleware/);
});

test("migration은 유저 상태, 멱등 작업, cascade/set null, 안전 rollback을 고정한다", () => {
  const migration = readRepositoryFile(
    "migrations/add_account_deletion_support.sql",
  );
  const rollback = readRepositoryFile(
    "migrations/rollback_account_deletion_support.sql",
  );
  const final_schema = readRepositoryFile("migrations/final_schema.sql");
  assert.match(migration, /CREATE TABLE account_deletion_requests/);
  assert.match(migration, /CREATE TABLE account_deletion_provider_tasks/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(rollback, /confirm_account_deletion_disabled/);
  assert.match(rollback, /EXISTS \(SELECT 1 FROM public\.account_deletion_requests\)/);
  assert.match(final_schema, /account_status text NOT NULL DEFAULT 'ACTIVE'/);
  assert.match(final_schema, /CREATE TABLE account_deletion_requests/);
});

test("워커는 provider 선행, DB purge, Redis tombstone 후에만 완료한다", () => {
  const worker = readRepositoryFile("src/workers/accountDeletionWorker.ts");
  const cache = readRepositoryFile(
    "src/services/workShiftMonthCacheService.ts",
  );
  const provider = readRepositoryFile(
    "src/services/accountDeletionProviderService.ts",
  );
  const process_body = worker.slice(
    worker.indexOf("export async function processAccountDeletionRequest"),
  );
  assert.ok(process_body.indexOf("processProviderTasks") < process_body.indexOf("purgeAccountData(request)"));
  assert.ok(
    process_body.indexOf("purgeAccountData(request)") <
      process_body.indexOf("purgeDeletedUserWorkShiftCache"),
  );
  assert.match(cache, /account-deleted:v1/);
  assert.match(cache, /deletion_tombstone_key/);
  assert.match(provider, /appleid\.apple\.com\/auth\/revoke/);
  assert.match(provider, /kapi\.kakao\.com\/v1\/user\/unlink/);
});
