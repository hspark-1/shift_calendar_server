const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");

process.env.GOOGLE_AUTH_ENABLED = "true";
process.env.GOOGLE_SERVER_CLIENT_ID =
  "123456789-test.apps.googleusercontent.com";
process.env.JWT_SECRET = "google-test-access-secret";
process.env.JWT_REFRESH_SECRET = "google-test-refresh-secret";

const {
  GoogleAuthError,
  GoogleService,
} = require("../dist/services/googleService.js");
const {
  validateGoogleAuthEnvironment,
} = require("../dist/config/environment.js");
const { logGoogleAuthEvent } = require("../dist/utils/logger.js");

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

function createVerifier(payload, capture) {
  return {
    async verifyIdToken(options) {
      if (capture) capture.options = options;
      return { getPayload: () => payload };
    },
  };
}

test("Google 환경 검증은 활성 시 Web application OAuth client ID를 강제한다", () => {
  assert.doesNotThrow(() => validateGoogleAuthEnvironment());

  const original_client_id = process.env.GOOGLE_SERVER_CLIENT_ID;
  process.env.GOOGLE_SERVER_CLIENT_ID = "ios-client-id";
  assert.throws(
    () => validateGoogleAuthEnvironment(),
    /Web application OAuth client ID 형식/,
  );
  process.env.GOOGLE_SERVER_CLIENT_ID = original_client_id;

  process.env.GOOGLE_AUTH_ENABLED = "false";
  delete process.env.GOOGLE_SERVER_CLIENT_ID;
  assert.doesNotThrow(() => validateGoogleAuthEnvironment());
  process.env.GOOGLE_SERVER_CLIENT_ID = original_client_id;
  process.env.GOOGLE_AUTH_ENABLED = "true";
});

test("verifyIdToken은 원문 ID Token과 고정 server audience를 전달하고 claim을 정규화한다", async () => {
  const capture = {};
  const service = new GoogleService({
    oauth_client: createVerifier(
      {
        sub: "google-subject-1",
        email: "  User@Example.COM ",
        email_verified: true,
        name: "  Google 사용자  ",
        picture: "https://lh3.googleusercontent.com/profile.png",
      },
      capture,
    ),
  });

  const identity = await service.verifyIdentityToken("signed-google-id-token");
  assert.deepEqual(capture.options, {
    idToken: "signed-google-id-token",
    audience: "123456789-test.apps.googleusercontent.com",
  });
  assert.deepEqual(identity, {
    subject: "google-subject-1",
    email: "user@example.com",
    name: "Google 사용자",
    profile_image_url: "https://lh3.googleusercontent.com/profile.png",
  });
});

test("이름과 사진 claim은 신규 사용자 초기값 규칙에 맞게 제한한다", async () => {
  const service = new GoogleService({
    oauth_client: createVerifier({
      sub: "google-subject-2",
      email: "fallback-name@example.com",
      email_verified: true,
      name: "x".repeat(101),
      picture: "http://example.com/insecure.png",
    }),
  });
  assert.deepEqual(await service.verifyIdentityToken("valid-token"), {
    subject: "google-subject-2",
    email: "fallback-name@example.com",
    name: "fallback-name",
    profile_image_url: null,
  });
});

test("서명/audience/issuer/만료 거부는 invalid token, 공개키 조회 장애는 upstream으로 구분한다", async () => {
  const invalid_service = new GoogleService({
    oauth_client: {
      async verifyIdToken() {
        throw new Error("Wrong recipient, payload audience != requiredAudience");
      },
    },
  });
  await assert.rejects(
    invalid_service.verifyIdentityToken("invalid-token"),
    (error) =>
      error instanceof GoogleAuthError &&
      error.code === "GOOGLE_INVALID_TOKEN" &&
      error.status_code === 401,
  );

  const upstream_service = new GoogleService({
    oauth_client: {
      async verifyIdToken() {
        const error = new Error("certificate endpoint unavailable");
        error.response = { status: 503 };
        throw error;
      },
    },
  });
  await assert.rejects(
    upstream_service.verifyIdentityToken("unverifiable-token"),
    (error) =>
      error instanceof GoogleAuthError &&
      error.code === "GOOGLE_UPSTREAM_UNAVAILABLE" &&
      error.status_code === 503,
  );
});

test("미확인·누락·형식 오류 이메일은 GOOGLE_EMAIL_UNAVAILABLE로 거절한다", async () => {
  for (const payload of [
    { sub: "subject", email: "user@example.com", email_verified: false },
    { sub: "subject", email_verified: true },
    { sub: "subject", email: "invalid-email", email_verified: true },
  ]) {
    const service = new GoogleService({
      oauth_client: createVerifier(payload),
    });
    await assert.rejects(
      service.verifyIdentityToken("token"),
      (error) =>
        error instanceof GoogleAuthError &&
        error.code === "GOOGLE_EMAIL_UNAVAILABLE",
    );
  }
});

test("기능 플래그가 false이면 Google controller는 request_id가 있는 503을 반환한다", async () => {
  process.env.GOOGLE_AUTH_ENABLED = "false";
  const {
    googleLoginWithToken,
  } = require("../dist/controllers/authController.js");
  let response_status = 200;
  let response_body;
  const response = {
    status(status_code) {
      response_status = status_code;
      return this;
    },
    json(body) {
      response_body = body;
      return this;
    },
  };
  try {
    await googleLoginWithToken(
      {
        body: { id_token: "disabled-token" },
        headers: {},
        ip: "127.0.0.1",
        socket: {},
        request_id: "google-disabled-request-id",
      },
      response,
    );
    assert.equal(response_status, 503);
    assert.equal(response_body.error.code, "GOOGLE_AUTH_DISABLED");
    assert.equal(response_body.request_id, "google-disabled-request-id");
  } finally {
    process.env.GOOGLE_AUTH_ENABLED = "true";
  }
});

test("Google 구조화 로그는 token, email, subject claim을 받을 필드가 없다", () => {
  const original_console_log = console.log;
  let output = "";
  console.log = (value) => {
    output += String(value);
  };
  try {
    logGoogleAuthEvent({
      request_id: "google-log-request-id",
      user_id: "00000000-0000-4000-8000-000000000001",
      result: "success",
      duration_ms: 12,
      is_new_user: true,
    });
  } finally {
    console.log = original_console_log;
  }
  assert.match(output, /"context":"google_auth"/);
  assert.match(output, /"action":"google_login"/);
  assert.doesNotMatch(output, /id_token|access_token|refresh_token|email|subject/);
});

test("route/OpenAPI/migration 정적 계약은 Google public API와 안전 rollback을 고정한다", () => {
  const routes = readRepositoryFile("src/routes/authRoutes.ts");
  const openapi_source = readRepositoryFile("src/openapi.ts");
  const spec = JSON.parse(
    readRepositoryFile("src/openapi/googleAuthOpenApi.json"),
  );
  const migration = readRepositoryFile("migrations/add_google_auth_support.sql");
  const preflight = readRepositoryFile("migrations/google_auth_preflight.sql");
  const postflight = readRepositoryFile("migrations/google_auth_postflight.sql");
  const rollback = readRepositoryFile("migrations/rollback_google_auth_support.sql");

  assert.match(routes, /"\/google\/token"[\s\S]*authRateLimitMiddleware/);
  assert.match(routes, /isLength\(\{ min: 1, max: 16384 \}\)/);
  assert.match(openapi_source, /googleAuthOpenApi\.json/);
  assert.ok(spec.paths["/auth/google/token"].post);
  assert.equal(
    spec.components.schemas.GoogleLoginResponse.properties.data.properties
      .expires_at.description,
    "Unix epoch milliseconds",
  );
  assert.ok(
    spec.components.schemas.GoogleErrorResponse.properties.error.properties.code.enum.includes(
      "ACCOUNT_LINK_REQUIRED",
    ),
  );
  assert.match(migration, /ALTER TABLE users[\s\S]*ADD COLUMN google_id text/);
  assert.match(migration, /CREATE UNIQUE INDEX idx_users_google_id/);
  assert.match(preflight, /PostgreSQL 16/);
  assert.match(preflight, /ALTER 권한/);
  assert.match(postflight, /indisvalid/);
  assert.match(postflight, /google_idISNOTNULL/);
  assert.match(postflight, /duplicate_count/);
  assert.match(rollback, /confirm_google_auth_disabled/);
  assert.match(rollback, /google_id 데이터가 존재합니다/);
});

test("User 모델·정본 DDL·schema.drawio는 google_id를 함께 반영한다", () => {
  for (const relative_path of [
    "src/models/User.ts",
    "migrations/final_schema.sql",
    "schema.drawio",
  ]) {
    assert.match(readRepositoryFile(relative_path), /google_id/);
  }
  const package_json = JSON.parse(readRepositoryFile("package.json"));
  assert.ok(package_json.dependencies["google-auth-library"]);
});
