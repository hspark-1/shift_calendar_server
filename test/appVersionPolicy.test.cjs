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

async function withServer(run) {
  const app = express();
  app.use(requestContextMiddleware);
  app.use("/api/v1", routes);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
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
    const body = await response.json();
    assert.equal(body.error.code, "APP_VERSION_POLICY_UNAVAILABLE");
    assert.ok(body.request_id);
    assert.equal(JSON.stringify(body).includes("private-value"), false);
  });
});
