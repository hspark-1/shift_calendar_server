const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const policy_config = require("../dist/config/appVersionPolicy.js");
const { getAppVersionPolicy, createAppVersionPolicy, validateAppVersionPolicyConfiguration, AppVersionPolicyConfigurationError } = require("../dist/services/appVersionPolicyService.js");
const routes = require("../dist/routes/appVersionPolicyRoutes.js").default;
const { requestContextMiddleware } = require("../dist/middlewares/requestContext.js");

const original_policies = policy_config.app_version_policies;
const legacy_keys = ["IOS", "ANDROID"].flatMap(platform => [
  `APP_UPDATE_${platform}_MIN_COMPATIBILITY_VERSION`,
  `APP_UPDATE_${platform}_URL`,
  `APP_UPDATE_${platform}_MESSAGE`,
]);
const original_environment = Object.fromEntries(legacy_keys.map(key => [key, process.env[key]]));
test.afterEach(() => {
  policy_config.app_version_policies = original_policies;
  for (const [key, value] of Object.entries(original_environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function replacePolicy(platform, fields) {
  policy_config.app_version_policies = {
    ...policy_config.app_version_policies,
    [platform]: { ...policy_config.app_version_policies[platform], ...fields },
  };
}

test("소스 정본은 양 플랫폼 최소값 1이며 응답 변경이 정본을 바꾸지 않는다", () => {
  assert.doesNotThrow(validateAppVersionPolicyConfiguration);
  assert.ok(Object.isFrozen(original_policies));
  for (const platform of ["IOS", "ANDROID"]) {
    assert.ok(Object.isFrozen(original_policies[platform]));
    const policy = getAppVersionPolicy(platform);
    assert.equal(policy.minimum_compatibility_version, 1);
    assert.equal(policy.update_url, original_policies[platform].update_url);
    policy.minimum_compatibility_version = 999;
    assert.equal(getAppVersionPolicy(platform).minimum_compatibility_version, 1);
  }
});

test("과거 env가 남아도 최소값·URL·안내 문구를 덮어쓰지 못한다", () => {
  for (const key of legacy_keys) process.env[key] = "invalid-env-override";
  assert.doesNotThrow(validateAppVersionPolicyConfiguration);
  for (const platform of ["IOS", "ANDROID"]) {
    assert.deepEqual(getAppVersionPolicy(platform), {
      schema_version: 1, platform, ...original_policies[platform],
    });
  }
});

test("플랫폼별 소스 설정과 최소값 0의 URL 생략을 검증한다", () => {
  const ios_policy = createAppVersionPolicy("IOS", {
    ...original_policies.IOS, minimum_compatibility_version: 2, message: "새 규격 앱으로 업데이트해 주세요.",
  });
  assert.equal(ios_policy.minimum_compatibility_version, 2);
  assert.equal(ios_policy.message, "새 규격 앱으로 업데이트해 주세요.");
  assert.equal(getAppVersionPolicy("ANDROID").minimum_compatibility_version, 1);
  for (const platform of ["IOS", "ANDROID"]) {
    const policy = createAppVersionPolicy(platform, {
      ...original_policies[platform], minimum_compatibility_version: 0, update_url: null,
    });
    assert.equal(policy.minimum_compatibility_version, 0);
    assert.equal(policy.update_url, null);
  }
});

test("잘못된 정수·스토어 URL·메시지는 설정 필드명 오류로 거절한다", () => {
  for (const value of [-1, 1.5, NaN, Infinity, 2147483648, "1", null, true]) {
    assert.throws(() => createAppVersionPolicy("IOS", { ...original_policies.IOS, minimum_compatibility_version: value }), AppVersionPolicyConfigurationError);
  }
  for (const update_url of [null, "", 123, "http://apps.apple.com/app/id6831957246", "https://apps.apple.com.evil.test/app/id6831957246", "https://apps.apple.com/app/id123", "https://user:secret@apps.apple.com/app/id6831957246", "https://apps.apple.com/app/id6831957246?redirect=https://evil.test"]) {
    assert.throws(() => createAppVersionPolicy("IOS", { ...original_policies.IOS, update_url }), error => error.configuration_field === "IOS.update_url");
  }
  for (const message of ["가".repeat(301), "  ", null, 123]) {
    assert.throws(() => createAppVersionPolicy("IOS", { ...original_policies.IOS, message }), error => error.configuration_field === "IOS.message");
  }
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

test("실제 HTTP는 무인증 no-store와 소스 정책을 반환하고 잘못된 플랫폼을 검증한다", async () => {
  process.env.APP_UPDATE_IOS_MIN_COMPATIBILITY_VERSION = "999";
  await withServer(async base_url => {
    const response = await fetch(`${base_url}?platform=IOS`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.headers.get("x-request-id"));
    assert.deepEqual(await response.json(), { success: true, data: getAppVersionPolicy("IOS") });
    for (const query_string of ["", "?platform=ios", "?platform=OTHER", "?platform=IOS&platform=ANDROID"]) {
      const invalid = await fetch(base_url + query_string);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
    }
  });
});

test("잘못된 소스 설정은 안전한 503과 필드명 로그만 제공한다", async () => {
  replacePolicy("IOS", { update_url: "https://private-value.example.test" });
  const error_logs = [];
  const original_error = console.error;
  console.error = line => error_logs.push(line);
  try {
    await withServer(async base_url => {
      const response = await fetch(`${base_url}?platform=IOS`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.error.code, "APP_VERSION_POLICY_UNAVAILABLE");
      assert.ok(body.request_id);
      assert.equal(body.request_id, response.headers.get("x-request-id"));
      assert.doesNotMatch(JSON.stringify(body) + error_logs.join(""), /private-value/);
      assert.equal(JSON.parse(error_logs[0]).configuration_field, "IOS.update_url");
    });
  } finally {
    console.error = original_error;
  }
});

test("API 시작은 잘못된 소스 정책을 DB 연결·listen 이전에 거절한다", () => {
  const { spawnSync } = require("node:child_process");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const fixture_directory = fs.mkdtempSync(path.join(os.tmpdir(), "app-policy-source-"));
  const fixture_path = path.join(fixture_directory, "invalidPolicy.cjs");
  fs.writeFileSync(fixture_path, `const config = require(${JSON.stringify(path.join(__dirname, "../dist/config/appVersionPolicy.js"))});
config.app_version_policies = { ...config.app_version_policies, ANDROID: { ...config.app_version_policies.ANDROID, minimum_compatibility_version: "invalid-secret-value" } };`);
  try {
    const result = spawnSync(process.execPath, ["-r", fixture_path, path.join(__dirname, "../dist/index.js")], {
      env: {
        PATH: process.env.PATH, NODE_ENV: "test",
        DB_HOST: "127.0.0.1", DB_PORT: "1", DB_NAME: "unused", DB_USER: "unused", DB_PASSWORD: "unused",
        JWT_SECRET: "unused-test-access", JWT_REFRESH_SECRET: "unused-test-refresh",
        GOOGLE_SERVER_CLIENT_ID: "policy-test.apps.googleusercontent.com",
      }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    const error_log = JSON.parse(result.stderr.trim());
    assert.equal(error_log.context, "server_start_failed");
    assert.equal(error_log.error_code, "APP_VERSION_POLICY_CONFIGURATION_ERROR");
    assert.equal(error_log.configuration_field, "ANDROID.minimum_compatibility_version");
    assert.doesNotMatch(result.stderr + result.stdout, /invalid-secret-value|PostgreSQL|서버가 .*실행 중/);
  } finally {
    fs.rmSync(fixture_directory, { recursive: true });
  }
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

test("정수 상한·300자 메시지와 Android 앱 식별자 경계를 검증한다", () => {
  const store_url = original_policies.ANDROID.update_url;
  const settings = { ...original_policies.ANDROID, minimum_compatibility_version: 2147483647, message: "가".repeat(300) };
  assert.equal(createAppVersionPolicy("ANDROID", settings).minimum_compatibility_version, 2147483647);
  for (const update_url of [
    store_url.replace("https:", "http:"),
    store_url.replace("play.google.com/", "play.google.com.evil.test/"),
    store_url.replace("com.hspark.shiftmate", "com.other.app"),
    `${store_url}&id=com.other.app`, `${store_url}&id=com.hspark.shiftmate`,
    `${store_url}#fragment`, store_url.replace("play.google.com/", "play.google.com:444/"),
  ]) {
    assert.throws(() => createAppVersionPolicy("ANDROID", { ...settings, update_url }), AppVersionPolicyConfigurationError);
  }
});

test("실제 앱 라우팅은 DB 없이 소스 정책과 2→0 복원을 응답한다", async () => {
  const { app } = require("../dist/index.js");
  const { sequelize } = require("../dist/config/database.js");
  const original_query = sequelize.query;
  sequelize.query = () => { throw new Error("정책 조회는 DB에 접근하면 안 됩니다."); };
  try {
    await withServer(async base_url => {
      for (const platform of ["IOS", "ANDROID"]) {
        const response = await fetch(`${base_url}?platform=${platform}`, { headers: { "X-Request-ID": "app-policy-contract-test" } });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^application\/json/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-request-id"), "app-policy-contract-test");
        assert.deepEqual((await response.json()).data, getAppVersionPolicy(platform));
      }
      for (const minimum of [2, 0]) {
        replacePolicy("IOS", { minimum_compatibility_version: minimum });
        const response = await fetch(`${base_url}?platform=IOS`);
        assert.equal((await response.json()).data.minimum_compatibility_version, minimum);
      }
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
