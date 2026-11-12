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
  process.env.AUTH_RATE_LIMIT_MAX = "200";
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
  const phone_responses = new Map();
  let last_verification_options;
  let api_server;
  let api_base_url;

  const fake_oauth_client = {
    async verifyIdToken(options) {
      last_verification_options = options;
      const payload = { ...current_payload };
      return { getPayload: () => payload };
    },
  };
  const fake_http_client = {
    async get(url, options) {
      const token = options.headers.Authorization.slice('Bearer '.length);
      const entry = phone_responses.get(token);
      assert.ok(entry, '실제 Google API를 호출하지 않는다');
      if (entry.error) throw entry.error;
      return { data: url.includes('/userinfo') ? { sub: entry.subject } : { phoneNumbers: entry.phones } };
    },
  };
  const service = new GoogleService({ oauth_client: fake_oauth_client, http_client: fake_http_client });

  function setPhone(token, subject, phones) {
    phone_responses.set(token, { subject, phones });
  }

  async function postLogin(body) {
    const response = await fetch(`${api_base_url}/api/v1/auth/google/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

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
    googleService.http_client = fake_http_client;

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
    assert.equal(body.data.user.profile_image_url, null);
    assert.equal(body.data.user.phone, null);
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

  test('HTTP 선택 access token으로 신규 전화번호를 저장하고 사진/body phone은 무시한다', async () => {
    setIdentity('google-phone-new', 'phone-new@example.com');
    setPhone('phone-new-access', 'google-phone-new', [{ canonicalForm: '+821012345678' }]);
    const { status, body } = await postLogin({ id_token: 'id-token', access_token: '  phone-new-access  ', phone: '010-9999-9999', profile_image_url: 'https://untrusted.example/photo.png' });
    assert.equal(status, 201);
    assert.equal(body.data.user.phone, '010-1234-5678');
    assert.equal(body.data.user.profile_image_url, null);
    assert.equal(body.data.requires_profile_setup, true);
    const user = await User.findByPk(body.data.user.user_id);
    assert.equal(user.phone, '010-1234-5678');
    assert.equal(user.profile_completed_at, null);
  });

  test('기존 빈 번호만 채우고 이름·사진/key·완료 시각·기존 번호는 보존한다', async () => {
    const completed_at = new Date('2026-01-01T00:00:00Z');
    const user = await User.create({ email: 'phone-existing@example.com', name: '저장 이름', google_id: 'phone-existing', profile_image_url: 'https://existing.example/photo.png', profile_image_key: 'existing-image-key', profile_completed_at: completed_at });
    setIdentity('phone-existing', 'changed-phone-email@example.com');
    setPhone('existing-access', 'phone-existing', [{ value: '010-2222-3333' }]);
    let result = await service.completeLogin({ id_token: 'id-token', access_token: 'existing-access' });
    assert.equal(result.user.phone, '010-2222-3333');
    await user.reload();
    assert.equal(user.email, 'phone-existing@example.com');
    assert.equal(user.name, '저장 이름');
    assert.equal(user.profile_image_url, 'https://existing.example/photo.png');
    assert.equal(user.profile_image_key, 'existing-image-key');
    assert.equal(user.profile_completed_at.toISOString(), completed_at.toISOString());
    setPhone('existing-access', 'phone-existing', [{ value: '010-4444-5555' }]);
    result = await service.completeLogin({ id_token: 'id-token', access_token: 'existing-access' });
    assert.equal(result.user.phone, '010-2222-3333');
  });

  test('선택 권한 거부·만료·장애와 미제공은 로그인/직접 입력을 유지한다', async () => {
    const { AxiosError } = require('axios');
    for (const [index, status] of [401, 403, 503].entries()) {
      const subject = `phone-fallback-${index}`;
      setIdentity(subject, `${subject}@example.com`);
      phone_responses.set(subject, { error: new AxiosError('private-google-token', undefined, undefined, undefined, { status }) });
      const result = await postLogin({ id_token: 'valid-id', access_token: subject });
      assert.equal(result.status, 201);
      assert.equal(result.body.data.user.phone, null);
      assert.equal(result.body.data.requires_profile_setup, true);
      assert.doesNotMatch(JSON.stringify(result.body), /private-google-token/);
    }
    setIdentity('phone-empty', 'phone-empty@example.com');
    setPhone('phone-empty', 'phone-empty', []);
    const result = await postLogin({ id_token: 'valid-id', access_token: 'phone-empty' });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.user.phone, null);
  });

  test('토큰 계정 불일치는 HTTP401이며 사용자·세션을 저장하지 않는다', async () => {
    setIdentity('phone-mismatch', 'phone-mismatch@example.com');
    setPhone('phone-mismatch-access', 'another-account', [{ value: '01012345678' }]);
    const result = await postLogin({ id_token: 'id-token', access_token: 'phone-mismatch-access' });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'GOOGLE_INVALID_TOKEN');
    assert.equal(await User.count({ where: { google_id: 'phone-mismatch' } }), 0);
  });

  test('선택 access token validation은 null/숫자/배열/공백/너무 긴 문자열을 거절한다', async () => {
    for (const access_token of [null, 1, [], {}, '  ', 'x'.repeat(16385)]) {
      const result = await postLogin({ id_token: 'id-token', access_token });
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.doesNotMatch(JSON.stringify(result.body), /phone-new-access/);
    }
  });

  test('번호 충돌409는 신규/빈 번호 사용자와 세션의 부분 저장을 남기지 않는다', async () => {
    await User.create({ email: 'phone-owner@example.com', name: '기존 번호 소유자', phone: '010-7777-8888' });
    for (const existing of [false, true]) {
      const subject = `phone-conflict-${existing}`;
      const user = existing ? await User.create({ email: `${subject}@example.com`, name: subject, google_id: subject }) : null;
      setIdentity(subject, `${subject}@example.com`);
      setPhone(subject, subject, [{ value: '01077778888' }]);
      const result = await postLogin({ id_token: 'id-token', access_token: subject });
      assert.equal(result.status, 409);
      assert.equal(result.body.error.code, 'PHONE_ALREADY_EXISTS');
      if (user) {
        await user.reload();
        assert.equal(user.phone, null);
        assert.equal(await RefreshToken.count({ where: { user_id: user.user_id } }), 0);
      } else assert.equal(await User.count({ where: { google_id: subject } }), 0);
    }
  });

  test('동일 번호 신규 동시 저장은 한 번만 성공하고 DB unique 오류도409로 매핑한다', async () => {
    const services = [1, 2].map((index) => {
      const subject = `phone-race-${index}`;
      setPhone(subject, subject, [{ value: '01055556666' }]);
      return new GoogleService({
        oauth_client: { async verifyIdToken() { return { getPayload: () => ({ sub: subject, email: `${subject}@example.com`, email_verified: true }) }; } },
        http_client: fake_http_client,
      });
    });
    const results = await Promise.allSettled(services.map((item, index) => item.completeLogin({ id_token: 'id-token', access_token: `phone-race-${index + 1}` })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failure = results.find((result) => result.status === 'rejected').reason;
    assert.equal(failure.code, 'PHONE_ALREADY_EXISTS');
    assert.equal(failure.status_code, 409);
    assert.equal(await User.count({ where: { phone: '010-5555-6666' } }), 1);
  });

  test('기존 빈 번호 갱신도 세션 저장 실패 시 rollback한다', async () => {
    const user = await User.create({ email: 'phone-rollback@example.com', name: '기존 사용자', google_id: 'phone-rollback' });
    setIdentity('phone-rollback', 'phone-rollback@example.com');
    setPhone('phone-rollback-access', 'phone-rollback', [{ value: '01088889999' }]);
    await sequelize.query(`ALTER TABLE refresh_tokens ADD CONSTRAINT ck_google_phone_refresh_failure CHECK (device_info IS DISTINCT FROM 'phone-refresh-failure')`);
    try {
      await assert.rejects(service.completeLogin({ id_token: 'id-token', access_token: 'phone-rollback-access', device_info: 'phone-refresh-failure' }));
      await user.reload();
      assert.equal(user.phone, null);
      assert.equal(await RefreshToken.count({ where: { user_id: user.user_id } }), 0);
    } finally {
      await sequelize.query('ALTER TABLE refresh_tokens DROP CONSTRAINT ck_google_phone_refresh_failure');
    }
  });

  test('탈퇴 진행 계정은 번호 변경과 새 세션 발급을 거절한다', async () => {
    const user = await User.create({ email: 'phone-deleting@example.com', name: '탈퇴 진행', google_id: 'phone-deleting', account_status: 'DELETION_PENDING' });
    setIdentity('phone-deleting', 'phone-deleting@example.com');
    setPhone('phone-deleting-access', 'phone-deleting', [{ value: '01099991111' }]);
    const result = await postLogin({ id_token: 'id-token', access_token: 'phone-deleting-access' });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'ACCOUNT_DELETION_IN_PROGRESS');
    await user.reload();
    assert.equal(user.phone, null);
    assert.equal(await RefreshToken.count({ where: { user_id: user.user_id } }), 0);
  });
}
