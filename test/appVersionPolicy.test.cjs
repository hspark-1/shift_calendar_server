const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { getAppVersionPolicy, validateAppVersionPolicyEnvironment, AppVersionPolicyConfigurationError } = require("../dist/services/appVersionPolicyService.js");
const routes = require("../dist/routes/appVersionPolicyRoutes.js").default;
const { requestContextMiddleware } = require("../dist/middlewares/requestContext.js");

const keys = ["IOS", "ANDROID"].flatMap(platform => [
  `APP_UPDATE_${platform}_MIN_COMPATIBILITY_VERSION`,
  `APP_UPDATE_${platform}_URL`,
  `APP_UPDATE_${platform}_MESSAGE`,
]);
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
test.beforeEach(() => keys.forEach(key => delete process.env[key]));
test.after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("기본값은 양 플랫폼 차단 비활성이며 iOS 스토어 주소는 확인된 앱을 가리킨다", () => {
  assert.doesNotThrow(validateAppVersionPolicyEnvironment);
  assert.equal(getAppVersionPolicy("IOS").minimum_compatibility_version, 0);
  assert.equal(getAppVersionPolicy("IOS").update_url, "https://apps.apple.com/kr/app/id6831957246");
  assert.equal(getAppVersionPolicy("ANDROID").minimum_compatibility_version, 0);
  assert.equal(getAppVersionPolicy("ANDROID").update_url, null);
});

test("플랫폼별 최소 호환 번호와 메시지는 독립적으로 설정한다", () => {
  process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = "2";
  process.env.APP_UPDATE_IOS_MESSAGE = "새 규격을 지원하는 앱으로 업데이트해 주세요.";
  assert.equal(getAppVersionPolicy("IOS").minimum_compatibility_version, 2);
  assert.equal(getAppVersionPolicy("IOS").message, process.env.APP_UPDATE_IOS_MESSAGE);
  assert.equal(getAppVersionPolicy("ANDROID").minimum_compatibility_version, 0);
  process.env.APP_UPDATE_ANDROID_MIN_COMPATIBILITY_VERSION = "2";
  assert.throws(validateAppVersionPolicyEnvironment, AppVersionPolicyConfigurationError);
  process.env.APP_UPDATE_ANDROID_URL = "https://play.google.com/store/apps/details?id=com.hspark.shiftmate";
  assert.doesNotThrow(validateAppVersionPolicyEnvironment);
});

test("정수가 아닌 버전·범위 초과·다른 앱/호스트 URL은 거절한다", () => {
  for (const value of ["-1", "1.0.0", "1.5", "2oops", "2147483648", ""]) {
    process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = value;
    assert.throws(validateAppVersionPolicyEnvironment, AppVersionPolicyConfigurationError);
  }
  process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = "2";
  for (const url of ["http://apps.apple.com/app/id6831957246", "https://apps.apple.com.evil.test/app/id6831957246", "https://apps.apple.com/app/id123", "https://user:secret@apps.apple.com/app/id6831957246", "https://apps.apple.com/app/id6831957246?redirect=https://evil.test"]) {
    process.env.APP_UPDATE_IOS_URL = url;
    assert.throws(validateAppVersionPolicyEnvironment, AppVersionPolicyConfigurationError);
  }
  delete process.env.APP_UPDATE_IOS_URL;
  process.env.APP_UPDATE_IOS_MESSAGE = "가".repeat(301);
  assert.throws(validateAppVersionPolicyEnvironment, AppVersionPolicyConfigurationError);
});

async function withServer(run, configured_app) {
  const app = configured_app ?? express();
  if (!configured_app) {
    app.use(requestContextMiddleware);
    app.use("/api/v1", routes);
  }
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/v1/app/version-policy`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("실제 HTTP 조회는 로그인 없이 no-store 정책을 반환하고 잘못된 플랫폼을 검증한다", async () => {
  process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = "2";
  await withServer(async base => {
    const response = await fetch(`${base}?platform=IOS`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.headers.get("x-request-id"));
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.schema_version, 1);
    assert.equal(body.data.platform, "IOS");
    assert.equal(body.data.minimum_compatibility_version, 2);
    for (const query of ["", "?platform=ios", "?platform=OTHER", "?platform=IOS&platform=ANDROID"]) {
      const invalid = await fetch(base + query);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
    }
  });
});

test("잘못된 운영 설정은 안전한 503이며 응답에 입력 값이 노출되지 않는다", async () => {
  process.env.APP_UPDATE_IOS_URL = "https://private-value.example.test";
  await withServer(async base => {
    const response = await fetch(`${base}?platform=IOS`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.error.code, "APP_VERSION_POLICY_UNAVAILABLE");
    assert.ok(body.request_id);
    assert.equal(body.request_id, response.headers.get("x-request-id"));
    assert.equal(JSON.stringify(body).includes("private-value"), false);
  });
});

test("API 시작은 잘못된 정책을 DB 연결·listen 이전에 거절한다", () => {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const result = spawnSync(process.execPath, [path.join(__dirname, "../dist/index.js")], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      DB_HOST: "127.0.0.1", DB_PORT: "1", DB_NAME: "unused", DB_USER: "unused", DB_PASSWORD: "unused",
      JWT_SECRET: "unused-test-access", JWT_REFRESH_SECRET: "unused-test-refresh",
      GOOGLE_SERVER_CLIENT_ID: "policy-test.apps.googleusercontent.com",
      APP_UPDATE_ANDROID_MIN_COMPATIBILITY_VERSION: "invalid-secret-value",
    },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const error_log = JSON.parse(result.stderr.trim());
  assert.equal(error_log.context, "server_start_failed");
  assert.equal(error_log.error_code, "APP_VERSION_POLICY_CONFIGURATION_ERROR");
  assert.equal(error_log.environment_variable, "APP_UPDATE_ANDROID_MIN_COMPATIBILITY_VERSION");
  assert.doesNotMatch(result.stderr + result.stdout, /invalid-secret-value|PostgreSQL|서버가 .*실행 중/);
});

test("생성된 OpenAPI는 무인증·오류 DTO·캐시 및 추적 헤더 계약을 제공한다", async () => {
  const { registerApiDocs } = require("../dist/openapi.js");
  const original_docs_enabled = process.env.API_DOCS_ENABLED;
  process.env.API_DOCS_ENABLED = "true";
  try {
    const docs_app = express();
    registerApiDocs(docs_app);
    await withServer(async base_url => {
      const docs_url = new URL("/api-docs/openapi.json", base_url);
      const response = await fetch(docs_url);
      assert.equal(response.status, 200);
      const spec = await response.json();
      const operation = spec.paths["/app/version-policy"].get;
      assert.deepEqual(operation.security, []);
      for (const status of ["200", "400", "503"]) {
        assert.ok(operation.responses[status].headers["Cache-Control"]);
        assert.ok(operation.responses[status].headers["X-Request-ID"]);
        assert.ok(operation.responses[status].content["application/json"].schema);
      }
      assert.ok(spec.components.schemas.AppVersionPolicy);
      assert.ok(spec.components.schemas.AppVersionPolicyError.required.includes("request_id"));
    }, docs_app);
  } finally {
    if (original_docs_enabled === undefined) delete process.env.API_DOCS_ENABLED;
    else process.env.API_DOCS_ENABLED = original_docs_enabled;
  }
});

test("정수 상한·300자 메시지와 Android URL의 앱 식별자 경계를 검증한다", () => {
  process.env.APP_UPDATE_ANDROID_MIN_COMPATIBILITY_VERSION = "2147483647";
  process.env.APP_UPDATE_ANDROID_MESSAGE = "가".repeat(300);
  const store_url = "https://play.google.com/store/apps/details?id=com.hspark.shiftmate";
  process.env.APP_UPDATE_ANDROID_URL = store_url;
  assert.doesNotThrow(validateAppVersionPolicyEnvironment);
  assert.equal(getAppVersionPolicy("ANDROID").minimum_compatibility_version, 2147483647);
  for (const invalid_url of [
    store_url.replace("https:", "http:"),
    store_url.replace("play.google.com/", "play.google.com.evil.test/"),
    store_url.replace("com.hspark.shiftmate", "com.other.app"),
    `${store_url}&id=com.other.app`,
    `${store_url}&id=com.hspark.shiftmate`,
    `${store_url}#fragment`,
    store_url.replace("play.google.com/", "play.google.com:444/"),
  ]) {
    process.env.APP_UPDATE_ANDROID_URL = invalid_url;
    assert.throws(validateAppVersionPolicyEnvironment, AppVersionPolicyConfigurationError);
  }
});

test("실제 앱 v1 라우팅은 인증·DB 조회 없이 양 플랫폼과 0 복원을 응답한다", async () => {
  const { app } = require("../dist/index.js");
  const { sequelize } = require("../dist/config/database.js");
  const original_query = sequelize.query;
  sequelize.query = () => { throw new Error("정책 조회는 DB에 접근하면 안 됩니다."); };
  try {
    await withServer(async base_url => {
      for (const platform of ["IOS", "ANDROID"]) {
        const response = await fetch(`${base_url}?platform=${platform}`, {
          headers: { "X-Request-ID": "app-policy-contract-test" },
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^application\/json/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-request-id"), "app-policy-contract-test");
        assert.deepEqual((await response.json()).data, getAppVersionPolicy(platform));
      }
      process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = "2";
      const blocked_response = await fetch(`${base_url}?platform=IOS`);
      assert.equal((await blocked_response.json()).data.minimum_compatibility_version, 2);
      process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = "0";
      const restored_response = await fetch(`${base_url}?platform=IOS`);
      assert.equal((await restored_response.json()).data.minimum_compatibility_version, 0);
      for (const query_string of ["?platform[]=IOS", "?platform[name]=IOS"]) {
        const response = await fetch(base_url + query_string);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
        assert.match(response.headers.get("cache-control"), /no-store/);
      }
    }, app);
  } finally {
    sequelize.query = original_query;
  }
});
