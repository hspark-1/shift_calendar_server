const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EnvironmentValidationError,
  validateAccountDeletionWorkerEnvironment,
  validateEnvironment,
  validatePushWorkerEnvironment,
} = require("../dist/config/environment.js");
const { logError } = require("../dist/utils/logger.js");

const managed_keys = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "NODE_ENV",
  "DB_SYNC",
  "GOOGLE_SERVER_CLIENT_ID",
  "WORK_SHIFT_CACHE_ENABLED",
  "PUSH_WORKER_ENABLED",
  "ACCOUNT_DELETION_WORKER_ENABLED",
  "FIREBASE_PROJECT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "KAKAO_ADMIN_KEY",
];

const original_environment = Object.fromEntries(
  managed_keys.map((key) => [key, process.env[key]]),
);

test.beforeEach(() => {
  Object.assign(process.env, {
    DB_HOST: "127.0.0.1",
    DB_PORT: "5432",
    DB_NAME: "environment_test",
    DB_USER: "environment_test",
    DB_PASSWORD: "environment_test",
    JWT_SECRET: "environment-test-access",
    JWT_REFRESH_SECRET: "environment-test-refresh",
    NODE_ENV: "test",
    DB_SYNC: "false",
    GOOGLE_SERVER_CLIENT_ID: "environment-test.apps.googleusercontent.com",
    WORK_SHIFT_CACHE_ENABLED: "false",
    PUSH_WORKER_ENABLED: "true",
    ACCOUNT_DELETION_WORKER_ENABLED: "true",
  });
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.KAKAO_ADMIN_KEY;
});

test.after(() => {
  for (const [key, value] of Object.entries(original_environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("공통 환경 검증은 활성 worker의 전용 secret을 요구하지 않는다", () => {
  assert.doesNotThrow(() => validateEnvironment());
});

test("push worker만 Firebase 필수값을 검증한다", () => {
  assert.throws(
    () => validatePushWorkerEnvironment(),
    (error) =>
      error instanceof EnvironmentValidationError &&
      error.environment_variable === "FIREBASE_PROJECT_ID",
  );
  process.env.FIREBASE_PROJECT_ID = "stage-project";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/run/secrets/firebase.json";
  assert.doesNotThrow(() => validatePushWorkerEnvironment());
});

test("회원 탈퇴 worker만 Kakao Admin Key를 검증한다", () => {
  assert.throws(
    () => validateAccountDeletionWorkerEnvironment(),
    (error) =>
      error instanceof EnvironmentValidationError &&
      error.environment_variable === "KAKAO_ADMIN_KEY",
  );
  process.env.KAKAO_ADMIN_KEY = "stage-admin-key";
  assert.doesNotThrow(() => validateAccountDeletionWorkerEnvironment());
});

test("환경변수 누락 로그는 secret 값 없이 key만 제공한다", () => {
  const original_console_error = console.error;
  let logged_value = "";
  console.error = (value) => {
    logged_value = value;
  };
  try {
    logError(
      "environment_test",
      new EnvironmentValidationError(
        "KAKAO_ADMIN_KEY",
        "민감한 값은 로그에 포함되면 안 됩니다.",
      ),
    );
  } finally {
    console.error = original_console_error;
  }

  const output = JSON.parse(logged_value);
  assert.equal(output.error_code, "ENVIRONMENT_VALIDATION_ERROR");
  assert.equal(output.environment_variable, "KAKAO_ADMIN_KEY");
  assert.doesNotMatch(logged_value, /민감한 값/);
});
