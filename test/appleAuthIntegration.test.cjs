const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const destructive_reset_is_explicitly_allowed =
  process.env.APPLE_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const is_isolated_debug_database =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

if (process.env.RUN_APPLE_AUTH_INTEGRATION !== "true") {
  test(
    "Apple PostgreSQL 16 통합 테스트는 명시적으로 활성화한다",
    { skip: true },
    () => {},
  );
} else if (
  !destructive_reset_is_explicitly_allowed ||
  !is_isolated_debug_database
) {
  test("Apple 통합 테스트는 고정된 격리 DB에서만 public schema를 초기화한다", () => {
    assert.fail(
      "APPLE_INTEGRATION_ALLOW_SCHEMA_RESET=true와 127.0.0.1:55432/shift_calendar_group_debug/group_debug 연결이 모두 필요합니다.",
    );
  });
} else {
  const temporary_directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "shiftmate-apple-integration-"),
  );
  const apple_client_keys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const apple_private_key_path = path.join(
    temporary_directory,
    "AuthKey_INTEGRATION.p8",
  );
  fs.writeFileSync(
    apple_private_key_path,
    apple_client_keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );

  process.env.NODE_ENV = "test";
  process.env.APPLE_TEAM_ID = "TEAMID1234";
  process.env.APPLE_KEY_ID = "KEYID12345";
  process.env.APPLE_IOS_CLIENT_ID = "com.hspark.shiftmate";
  process.env.APPLE_SERVICE_ID = "com.hspark.shiftmate.stage.web";
  process.env.APPLE_REDIRECT_URI =
    "https://stage-api.shiftmate.co.kr/api/v1/auth/apple/callback";
  process.env.APPLE_PRIVATE_KEY_PATH = apple_private_key_path;
  process.env.APPLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString(
    "base64",
  );
  process.env.APPLE_CHALLENGE_TTL_SECONDS = "300";
  process.env.APPLE_JWKS_CACHE_SECONDS = "21600";
  process.env.JWT_SECRET = "apple-integration-access-secret";
  process.env.JWT_REFRESH_SECRET = "apple-integration-refresh-secret";

  const jwt = require("jsonwebtoken");
  const axios = require("axios");
  const { QueryTypes } = require("sequelize");
  const {
    sequelize,
    connectDatabase,
    disconnectDatabase,
  } = require("../dist/config/database.js");
  const {
    OAuthAuthorization,
    OAuthLoginChallenge,
    RefreshToken,
    ShiftTemplate,
    User,
  } = require("../dist/models/index.js");
  const {
    AppleAuthError,
    AppleService,
  } = require("../dist/services/appleService.js");
  const { app } = require("../dist/index.js");

  const apple_identity_keys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const apple_public_jwk = apple_identity_keys.publicKey.export({
    format: "jwk",
  });
  apple_public_jwk.kid = "integration-apple-kid";
  apple_public_jwk.alg = "RS256";
  apple_public_jwk.use = "sig";

  const repository_root = path.resolve(__dirname, "..");
  let current_nonce = "";
  let current_subject = "";
  let current_email = "";
  let current_refresh_token = "";
  let token_endpoint_call_count = 0;
  let api_server;
  let api_base_url;

  const fake_http_client = {
    get: async () => ({
      data: { keys: [apple_public_jwk] },
      headers: { "cache-control": "max-age=3600" },
    }),
    post: async (_url, encoded_body) => {
      token_endpoint_call_count += 1;
      const parameters = new URLSearchParams(encoded_body);
      assert.equal(parameters.get("grant_type"), "authorization_code");
      const client_id = parameters.get("client_id");
      assert.ok(
        client_id === "com.hspark.shiftmate" ||
          client_id === "com.hspark.shiftmate.stage.web",
      );
      if (client_id === "com.hspark.shiftmate") {
        assert.equal(parameters.has("redirect_uri"), false);
      } else {
        assert.equal(
          parameters.get("redirect_uri"),
          "https://stage-api.shiftmate.co.kr/api/v1/auth/apple/callback",
        );
      }

      const id_token = jwt.sign(
        {
          nonce: current_nonce,
          email: current_email,
          email_verified: true,
        },
        apple_identity_keys.privateKey,
        {
          algorithm: "RS256",
          keyid: "integration-apple-kid",
          issuer: "https://appleid.apple.com",
          audience: client_id,
          subject: current_subject,
          expiresIn: 300,
        },
      );
      return {
        data: {
          access_token: "upstream-access-token-not-persisted",
          token_type: "Bearer",
          expires_in: 3600,
          ...(current_refresh_token
            ? { refresh_token: current_refresh_token }
            : {}),
          id_token,
        },
      };
    },
  };
  const service = new AppleService({ http_client: fake_http_client });

  async function applyAppleMigration() {
    const migration = fs
      .readFileSync(
        path.join(
          repository_root,
          "migrations",
          "add_apple_auth_support.sql",
        ),
        "utf8",
      )
      .replace(/^\\set .*$/gm, "");
    await sequelize.query(migration);
  }

  async function issueLoginInput(platform, subject, email, refresh_token) {
    const challenge = await service.createChallenge(platform);
    current_nonce = challenge.nonce;
    current_subject = subject;
    current_email = email;
    current_refresh_token = refresh_token;
    return {
      challenge,
      input: {
        platform,
        authorization_code: `code-${subject}`,
        state: challenge.state,
        nonce: challenge.nonce,
        given_name: "길동",
        family_name: "홍",
        device_info: "integration-test",
      },
    };
  }

  test.before(async () => {
    await connectDatabase();
    const base_schema = fs.readFileSync(
      path.join(__dirname, "fixtures", "groupIntegrationBaseSchema.sql"),
      "utf8",
    );
    await sequelize.query(base_schema);
    await sequelize.query(`
      CREATE TABLE refresh_tokens (
        token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        device_info text,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_refresh_tokens_hash
      ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;
    `);
    await applyAppleMigration();

    const table_names = await sequelize.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('oauth_login_challenges', 'oauth_authorizations')
        ORDER BY table_name
      `,
      { type: QueryTypes.SELECT },
    );
    assert.deepEqual(
      table_names.map((row) => row.table_name),
      ["oauth_authorizations", "oauth_login_challenges"],
    );
    await assert.rejects(applyAppleMigration(), /already exists/);
    // Node pg에서 BEGIN을 포함한 multi-statement query가 실패하면 같은 세션이
    // aborted transaction 상태로 남으므로 테스트 연결을 명시적으로 복구합니다.
    await sequelize.query("ROLLBACK");
    await new Promise((resolve) => {
      api_server = app.listen(0, "127.0.0.1", resolve);
    });
    api_base_url = `http://127.0.0.1:${api_server.address().port}`;
  });

  test.after(async () => {
    if (api_server) {
      await new Promise((resolve, reject) => {
        api_server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
    fs.rmSync(temporary_directory, { recursive: true, force: true });
  });

  test("공개 HTTP challenge/callback은 플랫폼 오류, 응답 형식, 고정 303 intent를 지킨다", async () => {
    const invalid_platform_response = await fetch(
      `${api_base_url}/api/v1/auth/apple/challenge`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "web" }),
      },
    );
    assert.equal(invalid_platform_response.status, 400);
    assert.equal(
      (await invalid_platform_response.json()).error.code,
      "APPLE_INVALID_PLATFORM",
    );

    const challenge_response = await fetch(
      `${api_base_url}/api/v1/auth/apple/challenge`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "android" }),
      },
    );
    assert.equal(challenge_response.status, 200);
    const challenge_body = await challenge_response.json();
    assert.equal(challenge_body.success, true);
    assert.equal(challenge_body.data.nonce.length, 43);
    assert.equal(challenge_body.data.state.length, 43);
    assert.equal(
      challenge_body.data.redirect_uri,
      "https://stage-api.shiftmate.co.kr/api/v1/auth/apple/callback",
    );

    const callback_parameters = new URLSearchParams({
      code: "http-callback-code",
      state: challenge_body.data.state,
      error: "user_cancelled_authorize",
      redirect_uri: "https://evil.example/steal",
    });
    const callback_response = await fetch(
      `${api_base_url}/api/v1/auth/apple/callback`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: callback_parameters,
        redirect: "manual",
      },
    );
    assert.equal(callback_response.status, 303);
    const callback_location = callback_response.headers.get("location");
    assert.match(callback_location, /^intent:\/\/callback\?/);
    assert.match(
      callback_location,
      /#Intent;package=com\.hspark\.shiftmate;scheme=signinwithapple;end$/,
    );
    assert.doesNotMatch(callback_location, /evil\.example/);

    const invalid_callback_response = await fetch(
      `${api_base_url}/api/v1/auth/apple/callback`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ state: "x".repeat(43) }),
        redirect: "manual",
      },
    );
    assert.equal(invalid_callback_response.status, 400);
    assert.equal(
      (await invalid_callback_response.json()).error.code,
      "APPLE_INVALID_CHALLENGE",
    );

    const invalid_login_challenge_response = await fetch(
      `${api_base_url}/api/v1/auth/apple`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "ios",
          authorization_code: "not-exchanged",
          state: "short",
          nonce: "n".repeat(43),
        }),
      },
    );
    assert.equal(invalid_login_challenge_response.status, 400);
    assert.equal(
      (await invalid_login_challenge_response.json()).error.code,
      "APPLE_INVALID_CHALLENGE",
    );
  });

  test("iOS 신규 로그인은 사용자·기본 템플릿·JWT·암호화 authorization을 한 transaction으로 만든다", async () => {
    const { challenge, input } = await issueLoginInput(
      "ios",
      "apple-ios-new-subject",
      "relay-ios@privaterelay.appleid.com",
      "apple-ios-refresh-token",
    );
    const result = await service.completeLogin(input);
    assert.equal(result.is_new_user, true);
    assert.equal(result.user.apple_id, "apple-ios-new-subject");
    assert.equal(result.user.name, "홍 길동");
    assert.equal(typeof result.tokens.expires_at, "number");

    const authorization = await OAuthAuthorization.findOne({
      where: { provider_subject: "apple-ios-new-subject" },
    });
    assert.ok(authorization);
    assert.notEqual(
      authorization.refresh_token_ciphertext.toString("utf8"),
      "apple-ios-refresh-token",
    );
    assert.equal(
      service.decryptRefreshToken(
        {
          ciphertext: authorization.refresh_token_ciphertext,
          iv: authorization.refresh_token_iv,
          auth_tag: authorization.refresh_token_auth_tag,
        },
        authorization.provider_subject,
        authorization.client_id,
      ),
      "apple-ios-refresh-token",
    );
    assert.equal(
      await ShiftTemplate.count({
        where: { owner_user_id: result.user.user_id },
      }),
      1,
    );
    assert.equal(
      await RefreshToken.count({ where: { user_id: result.user.user_id } }),
      1,
    );
    const consumed = await OAuthLoginChallenge.findOne({
      where: { state_hash: crypto.createHash("sha256").update(challenge.state).digest("hex") },
    });
    assert.ok(consumed.consumed_at);
  });

  test("같은 challenge 동시 소비와 replay에서는 정확히 한 요청만 Apple 교환으로 진행한다", async () => {
    const { input } = await issueLoginInput(
      "ios",
      "apple-race-subject",
      "race@privaterelay.appleid.com",
      "apple-race-refresh-token",
    );
    const calls_before = token_endpoint_call_count;
    const results = await Promise.allSettled([
      service.completeLogin(input),
      service.completeLogin(input),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected.reason instanceof AppleAuthError);
    assert.equal(rejected.reason.code, "APPLE_INVALID_CHALLENGE");
    assert.equal(token_endpoint_call_count - calls_before, 1);

    await assert.rejects(
      service.completeLogin(input),
      (error) =>
        error instanceof AppleAuthError &&
        error.code === "APPLE_INVALID_CHALLENGE",
    );
    assert.equal(token_endpoint_call_count - calls_before, 1);
  });

  test("Apple invalid_grant는 자동 재시도 없이 code 오류로 매핑하고 challenge를 소비한다", async () => {
    let invalid_grant_call_count = 0;
    const invalid_grant_service = new AppleService({
      http_client: {
        get: fake_http_client.get,
        post: async () => {
          invalid_grant_call_count += 1;
          throw new axios.AxiosError(
            "invalid grant",
            "ERR_BAD_REQUEST",
            undefined,
            undefined,
            {
              data: { error: "invalid_grant" },
              status: 400,
              statusText: "Bad Request",
              headers: {},
              config: { headers: {} },
            },
          );
        },
      },
    });
    const challenge = await invalid_grant_service.createChallenge("ios");
    const input = {
      platform: "ios",
      authorization_code: "already-used-code",
      state: challenge.state,
      nonce: challenge.nonce,
    };
    await assert.rejects(
      invalid_grant_service.completeLogin(input),
      (error) =>
        error instanceof AppleAuthError && error.code === "APPLE_CODE_INVALID",
    );
    assert.equal(invalid_grant_call_count, 1);
    await assert.rejects(
      invalid_grant_service.completeLogin(input),
      (error) =>
        error instanceof AppleAuthError &&
        error.code === "APPLE_INVALID_CHALLENGE",
    );
    assert.equal(invalid_grant_call_count, 1);
  });

  test("검증 이메일 충돌은 기존 계정에 Apple subject를 자동 연결하지 않는다", async () => {
    const existing_user = await User.create({
      email: "existing-account@shiftmate.test",
      name: "기존 사용자",
      timezone: "Asia/Seoul",
    });
    const { input } = await issueLoginInput(
      "ios",
      "apple-email-collision-subject",
      existing_user.email,
      "apple-collision-refresh-token",
    );
    await assert.rejects(
      service.completeLogin(input),
      (error) =>
        error instanceof AppleAuthError && error.code === "ACCOUNT_LINK_REQUIRED",
    );
    await existing_user.reload();
    assert.equal(existing_user.apple_id, null);
    assert.equal(
      await OAuthAuthorization.count({
        where: { provider_subject: "apple-email-collision-subject" },
      }),
      0,
    );
  });

  test("신규 authorization에 refresh token이 없으면 사용자와 JWT 생성을 rollback한다", async () => {
    const { input } = await issueLoginInput(
      "ios",
      "apple-no-refresh-subject",
      "no-refresh@privaterelay.appleid.com",
      "",
    );
    await assert.rejects(
      service.completeLogin(input),
      (error) =>
        error instanceof AppleAuthError &&
        error.code === "APPLE_REFRESH_TOKEN_UNAVAILABLE",
    );
    assert.equal(
      await User.count({ where: { apple_id: "apple-no-refresh-subject" } }),
      0,
    );
    assert.equal(
      await OAuthAuthorization.count({
        where: { provider_subject: "apple-no-refresh-subject" },
      }),
      0,
    );
  });

  test("기존 authorization 로그인은 Apple이 refresh token을 재발급하지 않아도 성공한다", async () => {
    const { input } = await issueLoginInput(
      "ios",
      "apple-ios-new-subject",
      "relay-ios@privaterelay.appleid.com",
      "",
    );
    const result = await service.completeLogin(input);
    assert.equal(result.is_new_user, false);
    assert.equal(result.user.apple_id, "apple-ios-new-subject");
  });

  test("Android callback은 미소비 state만 확인하고 고정 intent allowlist로 전달한 뒤 로그인에서 소비한다", async () => {
    const { challenge, input } = await issueLoginInput(
      "android",
      "apple-android-subject",
      "android@privaterelay.appleid.com",
      "apple-android-refresh-token",
    );
    const redirect_url = await service.buildAndroidCallbackRedirect({
      code: "android-code",
      id_token: "android-id-token",
      state: challenge.state,
      user: '{"name":"홍길동"}',
      redirect_uri: "https://evil.example/steal",
      package: "evil.package",
    });
    assert.match(redirect_url, /^intent:\/\/callback\?/);
    assert.match(
      redirect_url,
      /#Intent;package=com\.hspark\.shiftmate;scheme=signinwithapple;end$/,
    );
    assert.doesNotMatch(redirect_url, /evil\.example|evil\.package/);
    const result = await service.completeLogin(input);
    assert.equal(result.is_new_user, true);
    assert.equal(result.user.apple_id, "apple-android-subject");
  });
}
