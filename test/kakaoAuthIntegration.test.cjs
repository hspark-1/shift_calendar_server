const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const reset_allowed =
  process.env.KAKAO_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const isolated_database =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

if (process.env.RUN_KAKAO_AUTH_INTEGRATION !== "true") {
  test("Kakao PostgreSQL 16 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else if (!reset_allowed || !isolated_database) {
  test("Kakao 통합 테스트는 고정된 격리 DB에서만 public schema를 초기화한다", () => {
    assert.fail(
      "KAKAO_INTEGRATION_ALLOW_SCHEMA_RESET=true와 127.0.0.1:55432/shift_calendar_group_debug/group_debug 연결이 필요합니다.",
    );
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.KAKAO_APP_ID = "1234";
  process.env.JWT_SECRET = "kakao-integration-access-secret";
  process.env.JWT_REFRESH_SECRET = "kakao-integration-refresh-secret";

  const {
    sequelize,
    connectDatabase,
    disconnectDatabase,
  } = require("../dist/config/database.js");
  const { RefreshToken, ShiftTemplate, User } = require("../dist/models/index.js");
  const {
    KakaoAuthError,
    KakaoService,
    kakaoService,
  } = require("../dist/services/kakaoService.js");
  const { app } = require("../dist/index.js");

  let current_identity;
  let api_server;
  let api_base_url;
  const fake_http_client = {
    async get(url) {
      if (url.endsWith("/access_token_info")) {
        return {
          data: {
            id: current_identity.id,
            app_id: 1234,
            expires_in: 3600,
          },
        };
      }
      return {
        data: {
          id: current_identity.id,
          kakao_account: {
            email: current_identity.email,
            profile: { nickname: current_identity.name ?? "통합 사용자" },
          },
        },
      };
    },
  };
  const service = new KakaoService({ http_client: fake_http_client });

  function setIdentity(id, email, name) {
    current_identity = { id, email, name };
  }

  test.before(async () => {
    await connectDatabase();
    const schema = fs.readFileSync(
      path.join(__dirname, "fixtures", "kakaoAuthIntegrationSchema.sql"),
      "utf8",
    );
    await sequelize.query(schema);
    kakaoService.http_client = fake_http_client;
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

  test("신규 HTTP 로그인은 200, request_id와 명시적 is_new_user를 반환한다", async () => {
    setIdentity(1001, "kakao-http@example.com", "HTTP 사용자");
    const response = await fetch(`${api_base_url}/api/v1/auth/kakao/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: "kakao-http-token" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.is_new_user, true);
    assert.equal(body.data.user.kakao_id, "1001");
    assert.equal(typeof body.request_id, "string");
  });

  test("신규 사용자·기본 템플릿·Refresh Token을 한 transaction으로 만든다", async () => {
    setIdentity(1002, "kakao-transaction@example.com");
    const result = await service.completeLogin({
      access_token: "transaction-token",
      device_info: "kakao-integration",
    });
    assert.equal(result.is_new_user, true);
    assert.equal(
      await ShiftTemplate.count({ where: { owner_user_id: result.user.user_id } }),
      1,
    );
    assert.equal(
      await RefreshToken.count({ where: { user_id: result.user.user_id } }),
      1,
    );
  });

  test("기존 이메일은 Kakao ID를 연결하고 다른 Kakao ID는 덮어쓰지 않는다", async () => {
    const link_target = await User.create({
      email: "link-existing@example.com",
      name: "기존 사용자",
    });
    setIdentity(1003, "link-existing@example.com");
    const linked = await service.completeLogin({ access_token: "link-token" });
    assert.equal(linked.user.user_id, link_target.user_id);
    assert.equal(linked.is_new_user, false);

    setIdentity(1004, "link-existing@example.com");
    await assert.rejects(
      service.completeLogin({ access_token: "conflict-token" }),
      (error) =>
        error instanceof KakaoAuthError &&
        error.code === "KAKAO_ACCOUNT_CONFLICT" &&
        error.status_code === 409,
    );
    await link_target.reload();
    assert.equal(link_target.kakao_id, "1003");
  });

  test("동일 Kakao 회원의 동시 로그인은 사용자와 기본 템플릿을 하나만 만든다", async () => {
    setIdentity(1005, "kakao-concurrent@example.com");
    const results = await Promise.all([
      service.completeLogin({ access_token: "concurrent-token-1" }),
      service.completeLogin({ access_token: "concurrent-token-2" }),
    ]);
    assert.equal(await User.count({ where: { kakao_id: "1005" } }), 1);
    assert.deepEqual(
      results.map((result) => result.is_new_user).sort(),
      [false, true],
    );
    assert.equal(
      await ShiftTemplate.count({ where: { owner_user_id: results[0].user.user_id } }),
      1,
    );
  });

  test("Refresh Token 저장 실패는 사용자와 기본 템플릿까지 rollback한다", async () => {
    await sequelize.query(`
      ALTER TABLE refresh_tokens
      ADD CONSTRAINT ck_kakao_test_refresh_failure
      CHECK (device_info IS DISTINCT FROM 'force-refresh-failure')
    `);
    try {
      setIdentity(1006, "kakao-rollback@example.com");
      await assert.rejects(
        service.completeLogin({
          access_token: "rollback-token",
          device_info: "force-refresh-failure",
        }),
      );
      assert.equal(await User.count({ where: { kakao_id: "1006" } }), 0);
    } finally {
      await sequelize.query(`
        ALTER TABLE refresh_tokens
        DROP CONSTRAINT ck_kakao_test_refresh_failure
      `);
    }
  });
}
