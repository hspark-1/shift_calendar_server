const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");

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

test("Google 환경 검증은 항상 Web application OAuth client ID를 강제한다", () => {
  assert.doesNotThrow(() => validateGoogleAuthEnvironment());

  const original_client_id = process.env.GOOGLE_SERVER_CLIENT_ID;
  process.env.GOOGLE_SERVER_CLIENT_ID = "ios-client-id";
  assert.throws(
    () => validateGoogleAuthEnvironment(),
    /Web application OAuth client ID 형식/,
  );
  process.env.GOOGLE_SERVER_CLIENT_ID = original_client_id;

  delete process.env.GOOGLE_SERVER_CLIENT_ID;
  assert.throws(
    () => validateGoogleAuthEnvironment(),
    /필수 환경변수 GOOGLE_SERVER_CLIENT_ID/,
  );
  process.env.GOOGLE_SERVER_CLIENT_ID = original_client_id;
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
  });
});

test("이름 초기값을 제한하고 사진 claim은 사용하지 않는다", async () => {
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

test("Google 로그인은 feature flag 환경변수 없이 초기화된다", () => {
  delete process.env.GOOGLE_AUTH_ENABLED;
  const service = new GoogleService();
  assert.doesNotThrow(() => service.initialize());
  assert.doesNotMatch(
    readRepositoryFile(".env.example"),
    /^GOOGLE_AUTH_ENABLED=/m,
  );
  assert.doesNotMatch(
    readRepositoryFile("src/services/googleService.ts"),
    /GOOGLE_AUTH_ENABLED/,
  );
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

function createPhoneService({ subject = 'google-phone-subject', phones, fail_at, status = 403 } = {}) {
  const calls = [];
  const service = new GoogleService({
    http_client: {
      async get(url, options) {
        calls.push({ url, options });
        if (calls.length === fail_at) {
          const { AxiosError } = require('axios');
          throw new AxiosError('private-google-token-and-phone', undefined, undefined, undefined, { status });
        }
        return { data: calls.length === 1 ? { sub: subject } : { phoneNumbers: phones } };
      },
    },
  });
  return { service, calls };
}

test('선택 access token이 없으면 외부 전화번호 API를 호출하지 않는다', async () => {
  const { service, calls } = createPhoneService();
  assert.equal(await service.getPhoneForIdentity(undefined, 'google-phone-subject'), null);
  assert.equal(calls.length, 0);
});

test('서로 다른 Google 계정의 토큰은 번호 조회 전에 거절한다', async () => {
  const { service, calls } = createPhoneService({ subject: 'another-subject' });
  await assert.rejects(service.getPhoneForIdentity('access-token', 'google-phone-subject'),
    (error) => error.code === 'GOOGLE_INVALID_TOKEN' && error.status_code === 401);
  assert.equal(calls.length, 1);
});

test('국내/+82 번호만 정규화하고 사진 없이 profile 전화번호 필드만 조회한다', async () => {
  for (const value of ['01012345678', '010-1234-5678', '+82 10-1234-5678', '+821012345678']) {
    const { service, calls } = createPhoneService({ phones: [{ value }] });
    assert.equal(await service.getPhoneForIdentity('access-token', 'google-phone-subject'), '010-1234-5678');
    assert.equal(calls[0].url, 'https://openidconnect.googleapis.com/v1/userinfo');
    assert.equal(calls[1].url, 'https://people.googleapis.com/v1/people/me');
    assert.deepEqual(calls[1].options.params, { personFields: 'phoneNumbers', sources: 'READ_SOURCE_TYPE_PROFILE' });
    assert.equal(calls[1].options.headers.Authorization, 'Bearer access-token');
    assert.equal(calls[1].options.maxRedirects, 0);
    assert.equal(calls[1].options.timeout, 5000);
  }
});

test('미제공/외국/잘못된 값/모호한 여러 번호는 직접 입력으로 남긴다', async () => {
  for (const phones of [undefined, null, 'invalid', [], [null], [{ value: '+12025550123' }],
    [{ value: 1012345678 }], [{ value: 'garbage01012345678' }], [{ value: '02-1234-5678' }],
    [{ value: '01012345678' }, { value: '01098765432' }]]) {
    const { service } = createPhoneService({ phones });
    assert.equal(await service.getPhoneForIdentity('token', 'google-phone-subject'), null);
  }
});

test('canonicalForm 우선·동일 번호 중복 제거·명확한 primary 선택을 지원한다', async () => {
  for (const phones of [
    [{ canonicalForm: '+821012345678', value: 'invalid' }],
    [{ value: '01012345678' }, { value: '+821012345678' }],
    [{ value: '01098765432' }, { value: '01012345678', metadata: { primary: true } }],
  ]) {
    const { service } = createPhoneService({ phones });
    assert.equal(await service.getPhoneForIdentity('token', 'google-phone-subject'), '010-1234-5678');
  }
});

test('선택 정보의 권한 거부/만료/장애는 Google 로그인 대신 직접 입력으로 복귀한다', async () => {
  for (const fail_at of [1, 2]) {
    for (const status of [401, 403, 429, 500]) {
      const { service } = createPhoneService({ fail_at, status });
      assert.equal(await service.getPhoneForIdentity('token', 'google-phone-subject'), null);
    }
  }
});

test('ID Token에 사진 claim이 있어도 사진 값을 읽지 않는다', async () => {
  const payload = { sub: 'no-photo', email: 'no-photo@example.com', email_verified: true };
  Object.defineProperty(payload, 'picture', { get() { throw new Error('사진을 읽으면 안 됩니다.'); } });
  const service = new GoogleService({ oauth_client: createVerifier(payload) });
  assert.deepEqual(await service.verifyIdentityToken('id-token'), {
    subject: 'no-photo', email: 'no-photo@example.com', name: 'no-photo',
  });
});
