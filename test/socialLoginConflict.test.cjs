const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");
const { UniqueConstraintError } = require("sequelize");
const { sequelize } = require("../dist/config/database");
const { User, RefreshToken } = require("../dist/models");
const templates = require("../dist/services/shiftTemplateService");
const { googleService } = require("../dist/services/googleService");
const { appleService } = require("../dist/services/appleService");
const { kakaoService } = require("../dist/services/kakaoService");
const controller = require("../dist/controllers/authController");

process.env.JWT_SECRET = "social-conflict-test-access";
process.env.JWT_REFRESH_SECRET = "social-conflict-test-refresh";
process.env.NAVER_CLIENT_ID = "social-conflict-naver";
process.env.NAVER_CLIENT_SECRET = "social-conflict-naver-secret";
process.env.KAKAO_CLIENT_ID = "social-conflict-kakao";

const providers = [
  ["google", "google_id", "googleLoginWithToken", "ACCOUNT_LINK_REQUIRED"],
  ["apple", "apple_id", "appleLogin", "ACCOUNT_LINK_REQUIRED"],
  ["kakao", "kakao_id", "kakaoLoginWithToken", "KAKAO_ACCOUNT_CONFLICT"],
  ["naver", "naver_id", "naverLoginWithToken", "NAVER_ACCOUNT_CONFLICT"],
];

function userFor(provider_field, account_status = "ACTIVE", extra = {}) {
  return User.build({
    user_id: "00000000-0000-4000-8000-000000000001",
    email: "existing@example.test", name: "기존 사용자",
    [provider_field]: "subject", account_status, ...extra,
  });
}

function setup(t, { subject_user = null, email_user = null, phone_user = null, phone = null, unique_error = null } = {}) {
  const writes = [];
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(JSON.parse(line)));
  t.mock.method(console, "error", (line) => logs.push(JSON.parse(line)));
  t.mock.method(sequelize, "transaction", async (action) => {
    if (unique_error) throw unique_error;
    return action({ LOCK: { UPDATE: "UPDATE" } });
  });
  t.mock.method(sequelize, "query", async () => []);
  t.mock.method(User, "findOne", async ({ where }) => {
    if (where.phone) return phone_user;
    if (["google_id", "apple_id", "kakao_id", "naver_id"].some((field) => where[field])) return subject_user;
    return email_user;
  });
  t.mock.method(User, "create", async (fields) => {
    writes.push("user");
    return User.build({ ...fields, account_status: "ACTIVE" });
  });
  t.mock.method(User.prototype, "save", async function () { writes.push("save"); return this; });
  t.mock.method(RefreshToken, "create", async () => { writes.push("refresh"); });
  t.mock.method(templates, "ensureDefaultTemplate", async () => { writes.push("template"); });
  t.mock.method(googleService, "verifyIdentityToken", async () => ({ subject: "subject", email: "existing@example.test", name: "사용자" }));
  t.mock.method(googleService, "getPhoneForIdentity", async () => phone);
  t.mock.method(kakaoService, "verifyAccessToken", async () => ({ kakao_id: "subject", email: "existing@example.test", name: "사용자" }));
  t.mock.method(appleService, "consumeChallenge", async () => ({ client_id: "test-client" }));
  t.mock.method(appleService, "exchangeAuthorizationCode", async () => ({ id_token: "test-id", refresh_token: "test-refresh" }));
  t.mock.method(appleService, "verifyIdentityToken", async () => ({ subject: "subject", email: "existing@example.test", email_verified: true }));
  t.mock.method(appleService, "encryptRefreshToken", () => ({}));
  t.mock.method(appleService, "persistAuthorization", async () => { writes.push("authorization"); });
  t.mock.method(axios, "get", async () => ({ data: { resultcode: "00", response: { id: "subject", email: "existing@example.test", mobile: phone } } }));
  t.mock.method(axios, "post", async () => ({ data: { access_token: "test-token" } }));
  return { writes, logs };
}

async function login(handler) {
  const req = { body: { access_token: "test-token", id_token: "test-id", platform: "ios", code: "test-code", redirect_uri: "https://app.example.test/callback" }, headers: {}, socket: {}, request_id: "social-conflict-request" };
  const res = { status_code: 200, status(value) { this.status_code = value; return this; }, json(value) { this.body = value; return this; } };
  await controller[handler](req, res);
  return res;
}

for (const [provider, field, handler] of [
  ["kakao-code", "kakao_id", "kakaoLogin"],
  ["naver-code", "naver_id", "naverLogin"],
]) {
  test(`${provider}: code 로그인도 탈퇴 중 계정을 409로 처리한다`, async (t) => {
    const { writes } = setup(t, { subject_user: userFor(field, "DELETION_PENDING") });
    const result = await login(handler);
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
    assert.deepEqual(writes, []);
  });
}

for (const field of ["email", "naver_id"]) {
  test(`naver: DB ${field} unique 경쟁도 안전한 409로 변환한다`, async (t) => {
    setup(t, { unique_error: new UniqueConstraintError({ fields: { [field]: "private-value" } }) });
    const result = await login("naverLoginWithToken");
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, "NAVER_ACCOUNT_CONFLICT");
    assert.doesNotMatch(JSON.stringify(result.body), /private-value/);
  });
}

for (const [handler, field] of [["naverLoginWithToken", "naver_id"], ["kakaoLoginWithToken", "kakao_id"]]) {
  test(`${field}: unique 충돌 재조회에서도 탈퇴 상태를 우선한다`, async (t) => {
    setup(t, { email_user: userFor(field, "DELETION_PENDING"), unique_error: new UniqueConstraintError({ fields: { email: "private-value" } }) });
    const result = await login(handler);
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
  });

  test(`${field}: 사용자 외 unique 오류는 계정 충돌로 오분류하지 않는다`, async (t) => {
    setup(t, { unique_error: new UniqueConstraintError({ fields: { template_id: "private-template" } }) });
    const result = await login(handler);
    assert.equal(result.status_code, 500);
    assert.equal(result.body.error.code, "INTERNAL_SERVER_ERROR");
    assert.doesNotMatch(JSON.stringify(result.body), /private-template/);
  });
}

test("공통 JWT 발급 경계도 탈퇴 계정의 세션 저장을 차단한다", async (t) => {
  const { writes } = setup(t);
  const { generateTokens } = require("../dist/services/authService");
  await assert.rejects(generateTokens(userFor("apple_id", "DELETION_PENDING")), (error) => error.code === "ACCOUNT_DELETION_IN_PROGRESS" && error.status_code === 409);
  assert.deepEqual(writes, []);
});

for (const [provider, field, handler, conflict_code] of providers) {
  test(`${provider}: 탈퇴 직후 동일 subject 로그인은 409이며 저장·토큰 발급이 없다`, async (t) => {
    const { writes, logs } = setup(t, { subject_user: userFor(field, "DELETION_PENDING") });
    const result = await login(handler);
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
    assert.match(result.body.error.message, /탈퇴[\s\S]*완료/);
    assert.equal(result.body.request_id, "social-conflict-request");
    assert.deepEqual(writes, []);
    assert.ok(logs.some((event) => event.error_code === "ACCOUNT_DELETION_IN_PROGRESS" && event.request_id === "social-conflict-request"));
    assert.doesNotMatch(JSON.stringify(logs), /existing@example|test-token|test-refresh/);
  });

  test(`${provider}: 탈퇴 중인 이메일은 다른 subject 충돌보다 우선한다`, async (t) => {
    const { writes } = setup(t, { email_user: userFor(field, "DELETION_PENDING", { [field]: "old-subject" }) });
    const result = await login(handler);
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
    assert.deepEqual(writes, []);
  });

  test(`${provider}: 활성 기존 계정 충돌은 기존 409 코드를 유지한다`, async (t) => {
    const { writes } = setup(t, { email_user: userFor(field, "ACTIVE", { [field]: "another-subject" }) });
    const result = await login(handler);
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, conflict_code);
    assert.deepEqual(writes, []);
  });

  test(`${provider}: 같은 활성 subject는 기존 회원으로 로그인한다`, async (t) => {
    setup(t, { subject_user: userFor(field) });
    const result = await login(handler);
    assert.equal(result.status_code, 200);
    assert.equal(result.body.data.user.user_id, "00000000-0000-4000-8000-000000000001");
    assert.equal(typeof result.body.data.access_token, "string");
  });

  test(`${provider}: 삭제된 사용자 행이 없으면 새 회원과 세션을 만든다`, async (t) => {
    const { writes } = setup(t);
    const result = await login(handler);
    assert.equal(result.status_code, provider === "google" ? 201 : 200);
    assert.equal(result.body.message, "회원가입이 완료되었습니다.");
    assert.ok(writes.includes("user"));
    assert.ok(writes.includes("refresh"));
  });
}

for (const [provider, , handler] of providers.filter(([name]) => ["google", "naver"].includes(name))) {
  test(`${provider}: 탈퇴 중 계정의 번호는 PHONE_ALREADY_EXISTS와 구분한다`, async (t) => {
    const { writes } = setup(t, { phone: "010-1234-5678", phone_user: userFor("google_id", "DELETION_PENDING") });
    const result = await login(handler);
    assert.equal(result.status_code, 409);
    assert.equal(result.body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
    assert.deepEqual(writes, []);
  });
}
