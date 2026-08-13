const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const destructive_reset_is_explicitly_allowed =
  process.env.GOOGLE_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const is_isolated_debug_database =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

if (process.env.RUN_GOOGLE_AUTH_INTEGRATION !== "true") {
  test(
    "Google PostgreSQL 16 통합 테스트는 명시적으로 활성화한다",
    { skip: true },
    () => {},
  );
} else if (
  !destructive_reset_is_explicitly_allowed ||
  !is_isolated_debug_database
) {
  test("Google 통합 테스트는 고정된 격리 DB에서만 public schema를 초기화한다", () => {
    assert.fail(
      "GOOGLE_INTEGRATION_ALLOW_SCHEMA_RESET=true와 127.0.0.1:55432/shift_calendar_group_debug/group_debug 연결이 모두 필요합니다.",
    );
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_AUTH_ENABLED = "true";
  process.env.GOOGLE_SERVER_CLIENT_ID =
    "123456789-integration.apps.googleusercontent.com";
  process.env.JWT_SECRET = "google-integration-access-secret";
  process.env.JWT_REFRESH_SECRET = "google-integration-refresh-secret";

  const { QueryTypes } = require("sequelize");
  const {
    sequelize,
    connectDatabase,
    disconnectDatabase,
  } = require("../dist/config/database.js");
  const {
    RefreshToken,
    ShiftTemplate,
    User,
  } = require("../dist/models/index.js");
  const {
    GoogleAuthError,
    GoogleService,
    googleService,
  } = require("../dist/services/googleService.js");
  const { app } = require("../dist/index.js");

  const repository_root = path.resolve(__dirname, "..");
  let current_payload;
  let last_verification_options;
  let api_server;
  let api_base_url;

  const fake_oauth_client = {
    async verifyIdToken(options) {
      last_verification_options = options;
      return { getPayload: () => ({ ...current_payload }) };
    },
  };
  const service = new GoogleService({ oauth_client: fake_oauth_client });

  function setIdentity(subject, email, overrides = {}) {
    current_payload = {
      sub: subject,
      email,
      email_verified: true,
      name: "Google 통합 사용자",
      picture: "https://lh3.googleusercontent.com/integration.png",
      ...overrides,
    };
  }

  async function applyGoogleMigration() {
    const migration = fs
      .readFileSync(
        path.join(repository_root, "migrations", "add_google_auth_support.sql"),
        "utf8",
      )
      .replace(/^\\set .*$/gm, "");
    await sequelize.query(migration);
  }

  test.before(async () => {
    await connectDatabase();
    const base_schema = fs.readFileSync(
      path.join(__dirname, "fixtures", "googleAuthMigrationBaseSchema.sql"),
      "utf8",
    );
    await sequelize.query(base_schema);
    await applyGoogleMigration();
    googleService.oauth_client = fake_oauth_client;

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
  });

  test("migration은 nullable text와 valid/ready unique partial index, COMMENT를 만든다", async () => {
    const [column] = await sequelize.query(
      `
        SELECT data_type, is_nullable,
               col_description('public.users'::regclass, ordinal_position) AS comment
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'google_id'
      `,
      { type: QueryTypes.SELECT },
    );
    assert.equal(column.data_type, "text");
    assert.equal(column.is_nullable, "YES");
    assert.equal(
      column.comment,
      "Google OIDC subject(sub). 검증된 ID Token에서만 저장",
    );

    const [index] = await sequelize.query(
      `
        SELECT indexes.indisunique, indexes.indisvalid, indexes.indisready,
               pg_get_expr(indexes.indpred, indexes.indrelid) AS predicate
        FROM pg_class index_rel
        JOIN pg_index indexes ON indexes.indexrelid = index_rel.oid
        WHERE index_rel.relnamespace = 'public'::regnamespace
          AND index_rel.relname = 'idx_users_google_id'
      `,
      { type: QueryTypes.SELECT },
    );
    assert.equal(index.indisunique, true);
    assert.equal(index.indisvalid, true);
    assert.equal(index.indisready, true);
    assert.match(index.predicate, /google_id IS NOT NULL/);

    await User.bulkCreate([
      { email: "null-google-1@example.com", name: "Null One" },
      { email: "null-google-2@example.com", name: "Null Two" },
    ]);
    await User.create({
      email: "unique-google-1@example.com",
      name: "Unique One",
      google_id: "duplicate-google-id",
    });
    await assert.rejects(
      User.create({
        email: "unique-google-2@example.com",
        name: "Unique Two",
        google_id: "duplicate-google-id",
      }),
    );
  });

  test("신규 HTTP 로그인은 201과 명시적 is_new_user, millisecond expires_at을 반환한다", async () => {
    setIdentity("google-http-new", "Http.New@Example.com");
    const response = await fetch(`${api_base_url}/api/v1/auth/google/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id_token: "  google-http-id-token  " }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.message, "회원가입이 완료되었습니다.");
    assert.equal(body.data.is_new_user, true);
    assert.equal(body.data.user.email, "http.new@example.com");
    assert.equal(body.data.user.google_id, "google-http-new");
    assert.equal(Number.isInteger(body.data.expires_at), true);
    assert.ok(body.data.expires_at > Date.now());
    assert.equal(last_verification_options.idToken, "google-http-id-token");
    assert.equal(
      last_verification_options.audience,
      "123456789-integration.apps.googleusercontent.com",
    );
  });

  test("신규 사용자·기본 템플릿·refresh token은 한 transaction으로 생성된다", async () => {
    setIdentity("google-transaction-new", "transaction@example.com");
    const result = await service.completeLogin({
      id_token: "transaction-token",
      device_info: "google-integration",
    });
    assert.equal(result.is_new_user, true);
    assert.equal(result.user.google_id, "google-transaction-new");
    assert.equal(
      await ShiftTemplate.count({ where: { owner_user_id: result.user.user_id } }),
      1,
    );
    assert.equal(
      await RefreshToken.count({ where: { user_id: result.user.user_id } }),
      1,
    );
  });

  test("기존 google_id 로그인은 저장 프로필을 갱신하지 않고 새 refresh token만 만든다", async () => {
    const existing_user = await User.create({
      email: "stored-profile@example.com",
      name: "저장된 이름",
      profile_image_url: "https://example.com/stored.png",
      timezone: "UTC",
      google_id: "google-existing-subject",
    });
    setIdentity("google-existing-subject", "changed@example.com", {
      name: "변경된 Google 이름",
      picture: "https://example.com/changed.png",
    });
    const result = await service.completeLogin({ id_token: "existing-token" });
    assert.equal(result.is_new_user, false);
    await existing_user.reload();
    assert.equal(existing_user.email, "stored-profile@example.com");
    assert.equal(existing_user.name, "저장된 이름");
    assert.equal(existing_user.profile_image_url, "https://example.com/stored.png");
    assert.equal(existing_user.timezone, "UTC");
    assert.equal(
      await RefreshToken.count({ where: { user_id: existing_user.user_id } }),
      1,
    );
  });

  test("검증 이메일 충돌은 409 정책으로 종료하고 어떤 provider ID도 자동 연결하지 않는다", async () => {
    const existing_user = await User.create({
      email: "provider-collision@example.com",
      name: "기존 Provider 사용자",
      kakao_id: "existing-kakao-id",
    });
    setIdentity("google-collision-subject", "PROVIDER-COLLISION@example.com");
    await assert.rejects(
      service.completeLogin({ id_token: "collision-token" }),
      (error) =>
        error instanceof GoogleAuthError &&
        error.code === "ACCOUNT_LINK_REQUIRED" &&
        error.message ===
          "이미 다른 로그인 방식으로 가입된 이메일입니다. 기존 로그인 방식으로 로그인해주세요.",
    );
    await existing_user.reload();
    assert.equal(existing_user.google_id, null);
    assert.equal(existing_user.kakao_id, "existing-kakao-id");
    assert.equal(
      await User.count({ where: { google_id: "google-collision-subject" } }),
      0,
    );
  });

  test("동시 동일 sub 로그인은 사용자 한 명만 만들고 두 요청 모두 기존/신규 결과로 완료한다", async () => {
    setIdentity("google-concurrent-subject", "concurrent@example.com");
    const results = await Promise.all([
      service.completeLogin({ id_token: "concurrent-token-1" }),
      service.completeLogin({ id_token: "concurrent-token-2" }),
    ]);
    assert.equal(
      await User.count({ where: { google_id: "google-concurrent-subject" } }),
      1,
    );
    assert.deepEqual(
      results.map((result) => result.is_new_user).sort(),
      [false, true],
    );
    assert.equal(results[0].user.user_id, results[1].user.user_id);
  });

  test("refresh token 저장 단계 실패는 사용자와 기본 템플릿까지 rollback한다", async () => {
    await sequelize.query(`
      ALTER TABLE refresh_tokens
      ADD CONSTRAINT ck_google_test_refresh_failure
      CHECK (device_info IS DISTINCT FROM 'force-refresh-failure')
    `);
    try {
      setIdentity("google-rollback-subject", "rollback@example.com");
      await assert.rejects(
        service.completeLogin({
          id_token: "rollback-token",
          device_info: "force-refresh-failure",
        }),
      );
      assert.equal(
        await User.count({ where: { google_id: "google-rollback-subject" } }),
        0,
      );
      assert.equal(
        await ShiftTemplate.count({
          include: [
            {
              model: User,
              as: "owner",
              where: { google_id: "google-rollback-subject" },
              required: true,
            },
          ],
        }),
        0,
      );
    } finally {
      await sequelize.query(`
        ALTER TABLE refresh_tokens
        DROP CONSTRAINT ck_google_test_refresh_failure
      `);
    }
  });
}
