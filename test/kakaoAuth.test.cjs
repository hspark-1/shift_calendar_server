const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");
process.env.KAKAO_APP_ID = "1234";

const {
  KakaoAuthError,
  KakaoService,
} = require("../dist/services/kakaoService.js");
const { validateKakaoAuthEnvironment } = require("../dist/config/environment.js");
const { logKakaoAuthEvent } = require("../dist/utils/logger.js");
const {
  AccountDeletionProviderService,
} = require("../dist/services/accountDeletionProviderService.js");

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

function createHttpClient(responses, capture = []) {
  return {
    async get(url, options) {
      capture.push({ url, options });
      const next_response = responses.shift();
      if (next_response instanceof Error) throw next_response;
      return { data: next_response };
    },
  };
}

function axiosError(status, code) {
  const error = new Error("upstream details must not escape");
  error.isAxiosError = true;
  error.response = { status, data: { code, msg: "sensitive upstream body" } };
  return error;
}

test("Kakao 환경 검증은 API App ID의 양의 숫자 문자열만 허용한다", () => {
  assert.doesNotThrow(() => validateKakaoAuthEnvironment());
  const original_app_id = process.env.KAKAO_APP_ID;
  for (const invalid_value of ["", "0", "-1", "12.3", " app "]) {
    process.env.KAKAO_APP_ID = invalid_value;
    assert.throws(() => validateKakaoAuthEnvironment());
  }
  process.env.KAKAO_APP_ID = original_app_id;
});

test("Access Token 정보의 앱과 회원번호를 사용자 정보보다 먼저 검증한다", async () => {
  const capture = [];
  const service = new KakaoService({
    http_client: createHttpClient(
      [
        { id: 987654321, expires_in: 3600, app_id: 1234 },
        {
          id: 987654321,
          kakao_account: {
            email: "user@example.com",
            profile: { nickname: "사용자" },
          },
        },
      ],
      capture,
    ),
  });
  assert.deepEqual(await service.verifyAccessToken("kakao-access-token"), {
    kakao_id: "987654321",
    email: "user@example.com",
    name: "사용자",
    profile_image_url: undefined,
  });
  assert.equal(capture.length, 2);
  assert.match(capture[0].url, /access_token_info$/);
  assert.match(capture[1].url, /v2\/user\/me$/);
  assert.equal(capture[0].options.timeout, 5000);
  assert.equal(capture[1].options.timeout, 5000);
});

test("다른 app_id는 사용자 정보와 DB 경계에 진입하기 전에 거부한다", async () => {
  const capture = [];
  const service = new KakaoService({
    http_client: createHttpClient(
      [{ id: 987654321, expires_in: 3600, app_id: 9999 }],
      capture,
    ),
  });
  await assert.rejects(
    service.completeLogin({ access_token: "foreign-app-token" }),
    (error) =>
      error instanceof KakaoAuthError &&
      error.code === "KAKAO_TOKEN_APP_MISMATCH" &&
      error.status_code === 401,
  );
  assert.equal(capture.length, 1);
});

test("두 Kakao API의 회원번호 불일치와 이메일 누락을 공개 오류로 구분한다", async () => {
  const mismatch_service = new KakaoService({
    http_client: createHttpClient([
      { id: "11", expires_in: 3600, app_id: "1234" },
      { id: "12", kakao_account: { email: "user@example.com" } },
    ]),
  });
  await assert.rejects(
    mismatch_service.verifyAccessToken("token"),
    (error) => error.code === "KAKAO_TOKEN_SUBJECT_MISMATCH",
  );

  const no_email_service = new KakaoService({
    http_client: createHttpClient([
      { id: 11, expires_in: 3600, app_id: 1234 },
      { id: 11, kakao_account: {} },
    ]),
  });
  await assert.rejects(
    no_email_service.verifyAccessToken("token"),
    (error) =>
      error.code === "KAKAO_EMAIL_UNAVAILABLE" && error.status_code === 400,
  );
});

test("unsafe·누락된 숫자 응답은 502로 거부한다", async () => {
  for (const token_info of [
    { id: Number.MAX_SAFE_INTEGER + 1, expires_in: 3600, app_id: 1234 },
    { id: 1, expires_in: 0, app_id: 1234 },
    { id: 1, expires_in: 3600 },
  ]) {
    const service = new KakaoService({
      http_client: createHttpClient([token_info]),
    });
    await assert.rejects(
      service.verifyAccessToken("token"),
      (error) =>
        error.code === "KAKAO_INVALID_UPSTREAM_RESPONSE" &&
        error.status_code === 502,
    );
  }

  for (const responses of [
    [null],
    [
      { id: 11, expires_in: 3600, app_id: 1234 },
      null,
    ],
    [
      { id: 11, expires_in: 3600, app_id: 1234 },
      { id: 11, kakao_account: { email: 1234 } },
    ],
  ]) {
    const service = new KakaoService({
      http_client: createHttpClient(responses),
    });
    await assert.rejects(
      service.verifyAccessToken("token"),
      (error) =>
        error.code === "KAKAO_INVALID_UPSTREAM_RESPONSE" ||
        error.code === "KAKAO_EMAIL_UNAVAILABLE",
    );
  }
});

test("만료 토큰과 Kakao 일시 장애를 구분한다", async () => {
  const invalid_service = new KakaoService({
    http_client: createHttpClient([axiosError(401, -401)]),
  });
  await assert.rejects(
    invalid_service.verifyAccessToken("expired-token"),
    (error) =>
      error.code === "KAKAO_INVALID_TOKEN" && error.status_code === 401,
  );

  for (const error of [
    axiosError(undefined, undefined),
    axiosError(429, -10),
    axiosError(500, -1),
    axiosError(400, -603),
  ]) {
    const service = new KakaoService({
      http_client: createHttpClient([error]),
    });
    await assert.rejects(
      service.verifyAccessToken("token"),
      (mapped_error) =>
        mapped_error.code === "KAKAO_UPSTREAM_UNAVAILABLE" &&
        mapped_error.status_code === 503,
    );
  }
});

test("Kakao 구조화 로그는 credential과 외부 신원 필드를 받을 수 없다", () => {
  const original_console_log = console.log;
  let output = "";
  console.log = (value) => {
    output += String(value);
  };
  try {
    logKakaoAuthEvent({
      request_id: "kakao-request-id",
      user_id: "00000000-0000-4000-8000-000000000001",
      action: "token_login",
      result: "success",
      duration_ms: 10,
      is_new_user: true,
    });
  } finally {
    console.log = original_console_log;
  }
  assert.match(output, /"context":"kakao_auth"/);
  assert.doesNotMatch(
    output,
    /access_token|refresh_token|email|kakao_id|app_id|upstream_response/,
  );
});

test("route와 OpenAPI는 SDK token 계약과 1차 레거시 관찰을 고정한다", () => {
  const routes = readRepositoryFile("src/routes/authRoutes.ts");
  const controller = readRepositoryFile("src/controllers/authController.ts");
  const openapi_source = readRepositoryFile("src/openapi.ts");
  const spec = JSON.parse(
    readRepositoryFile("src/openapi/kakaoAuthOpenApi.json"),
  );

  assert.match(routes, /"\/kakao\/token"[\s\S]*authRateLimitMiddleware/);
  assert.match(routes, /isLength\(\{ min: 1, max: 4096 \}\)/);
  assert.match(routes, /matches\(\/\^\\S\+\$\//);
  assert.match(controller, /request_id: req\.request_id/);
  assert.match(controller, /is_new_user: result\.is_new_user/);
  assert.match(controller, /action: "legacy_route_access"/);
  assert.doesNotMatch(controller, /auth_kakao_token_login_failed/);
  assert.match(openapi_source, /kakaoAuthOpenApi\.json/);
  assert.ok(spec.paths["/auth/kakao/token"].post.responses["502"]);
  assert.equal(spec.paths["/auth/kakao"].post.deprecated, true);
  assert.ok(
    spec.components.schemas.KakaoErrorResponse.properties.error.properties.code.enum.includes(
      "KAKAO_TOKEN_APP_MISMATCH",
    ),
  );
});

test("Kakao unlink는 worker secret과 저장된 회원번호를 사용하고 응답 ID를 검증한다", async () => {
  const capture = {};
  const service = new AccountDeletionProviderService({
    find_user_by_pk: async () => ({ kakao_id: "987654321" }),
    kakao_admin_key_provider: () => "worker-only-admin-key",
    http_client: {
      async post(url, body, options) {
        capture.url = url;
        capture.body = body;
        capture.options = options;
        return { data: { id: 987654321 } };
      },
    },
  });
  await service.unlinkKakao("internal-user-id");
  assert.match(capture.url, /\/v1\/user\/unlink$/);
  assert.match(capture.body, /target_id_type=user_id/);
  assert.match(capture.body, /target_id=987654321/);
  assert.equal(
    capture.options.headers.Authorization,
    "KakaoAK worker-only-admin-key",
  );

  const mismatch_service = new AccountDeletionProviderService({
    find_user_by_pk: async () => ({ kakao_id: "987654321" }),
    kakao_admin_key_provider: () => "worker-only-admin-key",
    http_client: {
      async post() {
        return { data: { id: 111 } };
      },
    },
  });
  await assert.rejects(
    mismatch_service.unlinkKakao("internal-user-id"),
    (error) => error.code === "KAKAO_UNLINK_REJECTED",
  );
});

test("Kakao unlink의 공식 -101은 멱등 성공으로 처리한다", async () => {
  const service = new AccountDeletionProviderService({
    find_user_by_pk: async () => ({ kakao_id: "987654321" }),
    kakao_admin_key_provider: () => "worker-only-admin-key",
    http_client: {
      async post() {
        throw axiosError(400, -101);
      },
    },
  });
  await assert.doesNotReject(service.unlinkKakao("internal-user-id"));
});
