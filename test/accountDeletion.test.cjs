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
  assert.match(final_schema, /GRANT ALL ON SCHEMA public TO CURRENT_USER/);
  assert.doesNotMatch(final_schema, /GRANT ALL ON SCHEMA public TO postgres/);
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

test("회원 탈퇴 worker health는 활성화 시 migration schema를 검증한다", () => {
  const worker = readRepositoryFile("src/workers/accountDeletionWorker.ts");
  const health_body = worker.slice(
    worker.indexOf("async function runHealthCheck"),
    worker.indexOf("async function shutdown"),
  );
  assert.match(health_body, /isAccountDeletionWorkerEnabled\(\)/);
  assert.match(
    health_body,
    /SELECT account_status, deletion_requested_at FROM users LIMIT 0/,
  );
  assert.match(health_body, /AccountDeletionRequest\.count\(\)/);
  assert.match(health_body, /AccountDeletionProviderTask\.count\(\)/);
});

const worker_loop_probe = `
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { setTimeout: delay } = require('node:timers/promises');
  const actual_environment = require('./dist/config/environment');
  const scenario = process.env.WORKER_TEST_SCENARIO;
  let claim_count = 0;
  let heartbeat_count = 0;
  const modules = {
    '../config/privacy': { getPrivacyRetentionDays: () => 30 },
    '../config/environment': {
      ...actual_environment,
      validateEnvironment() {},
      validateAccountDeletionWorkerEnvironment() {},
      validateAppleAuthEnvironment() {},
    },
    '../config/accountDeletion': require('./dist/config/accountDeletion'),
    '../config/database': {
      connectDatabase: async () => {},
      disconnectDatabase: async () => console.log(JSON.stringify({ closed: 'database' })),
      sequelize: {
        transaction: async (callback) => callback({}),
        query: async (sql) => {
          if (scenario === 'error') throw new Error('TEST_DATABASE_UNAVAILABLE');
          if (sql.includes('RETURNING deletion_request_id')) {
            claim_count += 1;
            return scenario === 'busy' && claim_count === 1
              ? [{ deletion_request_id: 'completed-request' }] : [];
          }
          if (sql.includes('INSERT INTO privacy_worker_heartbeats')) heartbeat_count += 1;
          return [];
        },
      },
    },
    '../config/redis': {
      disconnectRedis: async () => console.log(JSON.stringify({ closed: 'redis' })),
    },
    '../models': { AccountDeletionRequest: { findByPk: async () => null } },
    '../services/deviceService': { cleanupUnboundDevices: async () => 0 },
    '../services/accountDeletionService': { cleanupCompletedAccountDeletionRequests: async () => {} },
    '../services/accountDeletionImageService': {},
    '../services/profileImageCleanupService': { processProfileImageCleanupBatch: async () => {} },
    '../services/accountDeletionProviderService': {},
    '../services/workShiftMonthCacheService': {},
    '../utils/accountDataLock': {},
    '../utils/logger': { logError: (context) => console.log(JSON.stringify({ error_context: context })) },
    'sequelize': { QueryTypes: { SELECT: 'SELECT' } },
    'node:timers/promises': {
      setTimeout: (poll_ms, value, options) => {
        console.log(JSON.stringify({ waiting: true, poll_ms, claim_count, heartbeat_count }));
        const pending = delay(poll_ms, value, options);
        setImmediate(() => process.kill(process.pid, process.env.WORKER_TEST_SIGNAL));
        return pending;
      },
    },
  };
  const worker_module = { exports: {} };
  const worker_require = (name) => {
    if (!(name in modules) && name !== 'crypto') throw new Error('Unexpected dependency: ' + name);
    return name in modules ? modules[name] : require(name);
  };
  worker_require.main = worker_module;
  vm.runInNewContext(fs.readFileSync('./dist/workers/accountDeletionWorker.js', 'utf8'), {
    require: worker_require, module: worker_module, exports: worker_module.exports,
    process, console, AbortController,
  });
`;

for (const scenario of ['empty', 'busy', 'disabled', 'error', 'override']) {
  test(`탈퇴 워커 ${scenario}: 폴링 주기와 종료 신호 처리`, () => {
    const { spawnSync } = require('node:child_process');
    const signal = scenario === 'override' ? 'SIGINT' : 'SIGTERM';
    const env = { ...process.env, ACCOUNT_DELETION_WORKER_ENABLED: String(scenario !== 'disabled'),
      WORKER_TEST_SCENARIO: scenario, WORKER_TEST_SIGNAL: signal };
    env.ACCOUNT_DELETION_POLL_MS = "";
    if (scenario === 'override') env.ACCOUNT_DELETION_POLL_MS = '20000';
    const result = spawnSync(process.execPath, ['-e', worker_loop_probe], {
      cwd: repository_root, env, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    const waits = events.filter((event) => event.waiting);
    assert.equal(waits.length, 1);
    assert.equal(waits[0].poll_ms, scenario === 'override' ? 20000 : 600000);
    assert.equal(waits[0].claim_count, scenario === 'busy' ? 2 : ['disabled', 'error'].includes(scenario) ? 0 : 1);
    assert.equal(waits[0].heartbeat_count, scenario === 'busy' ? 2 : ['disabled', 'error'].includes(scenario) ? 0 : 1);
    assert.ok(events.some((event) => event.context === 'account_deletion_worker_stopping' && event.signal === signal));
    assert.equal(events.filter((event) => event.closed === 'database').length, 1);
    assert.equal(events.filter((event) => event.closed === 'redis').length, 1);
    const errors = events.filter((event) => event.error_context);
    assert.deepEqual(errors.map((event) => event.error_context), scenario === 'error' ? ['account_deletion_worker_batch_failed'] : []);
  });
}
