const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const test = require("node:test");
const enabled = process.env.RUN_PRIVATE_PROFILE_INTEGRATION === "true";
const isolated = process.env.PRIVATE_PROFILE_INTEGRATION_ALLOW_SCHEMA_RESET === "true" &&
  process.env.DB_HOST === "127.0.0.1" && process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" && process.env.DB_USER === "group_debug";
if (!enabled) {
  test("비공개 이미지 HTTP 통합은 격리 DB 명시 활성화 필요", { skip: true }, () => {});
} else if (!isolated) {
  test("공유 DB 초기화 거절", () => assert.fail("고정 격리 DB와 schema reset 동의 필요"));
} else {
  Object.assign(process.env, {
    NODE_ENV: "test", PROFILE_IMAGE_STORAGE_BUCKET: "profile-private-test",
    PROFILE_IMAGE_STORAGE_REGION: "ap-northeast-2", PROFILE_IMAGE_STORAGE_PREFIX: "test",
    PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE: "true", PROFILE_IMAGE_PUBLIC_BASE_URL: "https://legacy.example.test",
    PROFILE_IMAGE_API_BASE_URL: "https://api.example.test", AWS_ACCESS_KEY_ID: "private_test",
    AWS_SECRET_ACCESS_KEY: "private_test_local_only", JWT_SECRET: "private-profile-access",
    JWT_REFRESH_SECRET: "private-profile-refresh", REDIS_URL: "", AUTH_RATE_LIMIT_MAX: "200",
  });
  const { sequelize } = require("../dist/config/database");
  const { User } = require("../dist/models");
  const { backfillProfileImages } = require("../dist/scripts/profileImageBackfill");
  const { updateProfileFields } = require("../dist/services/profileService");
  const jwt = require("jsonwebtoken");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const objects = new Map();
  let storage_server;
  let api_server;
  let base_url;
  let next_error = null;
  let read_count = 0;
  let signed_requests = 0;
  let owner;
  let viewer;
  let owner_key;
  function sql(file) { return fs.readFileSync(file, "utf8").split("\n").filter((line) => !line.startsWith("\\")).join("\n"); }
  async function user(extra = {}) { return User.create({ email: `${crypto.randomUUID()}@example.test`, name: "이미지 사용자", ...extra }); }
  function token(current_user) { return jwt.sign({ user_id: current_user.user_id, email: current_user.email }, process.env.JWT_SECRET, { expiresIn: "5m" }); }
  function headers(current_user = viewer) { return { Authorization: `Bearer ${token(current_user)}` }; }
  async function listen(server) { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); return server.address().port; }

  test.before(async () => {
    await sequelize.authenticate();
    await sequelize.query(sql("migrations/final_schema.sql"));
    await sequelize.query(sql("migrations/add_private_profile_images.sql"));
    await sequelize.query(sql("migrations/add_private_profile_images.sql"));
    storage_server = http.createServer(async (req, res) => {
      const object_path = new URL(req.url, "http://storage.test").pathname;
      if (req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) signed_requests += 1;
      if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        objects.set(object_path, { bytes: Buffer.concat(chunks), type: req.headers["content-type"] });
        res.writeHead(200, { ETag: '"test-object"' }); res.end(); return;
      }
      if (req.method === "DELETE") { objects.delete(object_path); res.writeHead(204); res.end(); return; }
      read_count += 1;
      const error_code = next_error;
      next_error = null;
      const object = objects.get(object_path);
      if (error_code || !object) {
        const code = error_code ?? "NoSuchKey";
        res.writeHead(code === "AccessDenied" ? 403 : 404, { "Content-Type": "application/xml" });
        res.end(`<Error><Code>${code}</Code><Message>test-only</Message></Error>`); return;
      }
      res.writeHead(200, { "Content-Type": object.type, "Content-Length": object.bytes.length });
      res.end(object.bytes);
    });
    const storage_port = await listen(storage_server);
    process.env.PROFILE_IMAGE_STORAGE_ENDPOINT = `http://127.0.0.1:${storage_port}`;
    const { app } = require("../dist/index");
    api_server = http.createServer(app);
    const api_port = await listen(api_server);
    base_url = `http://127.0.0.1:${api_port}`;
    owner = await user(); viewer = await user();
  });
  test.after(async () => {
    for (const server of [api_server, storage_server]) {
      if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    }
    await sequelize.close();
  });

  test("실제 SDK 업로드 → 객체 key 저장 → 인증된 API가 같은 이미지 바이트 전달", async () => {
    const form = new FormData();
    form.set("name", "이미지 사용자"); form.set("timezone", "Asia/Seoul"); form.set("phone", "01012345678");
    form.set("profile_image", new Blob([png], { type: "image/png" }), "p.png");
    const uploaded = await fetch(`${base_url}/api/v1/auth/profile/complete`, { method: "POST", headers: headers(owner), body: form });
    assert.equal(uploaded.status, 200);
    const result = await uploaded.json();
    assert.equal(result.data.profile_image_url, `https://api.example.test/api/v1/profile-images/${owner.user_id}`);
    assert.equal(result.data.profile_image_key, undefined);
    await owner.reload(); owner_key = owner.profile_image_key;
    assert.match(owner_key, /^test\/profiles\//);
    assert.equal(objects.size, 1);
    const response = await fetch(`${base_url}/api/v1/profile-images/${owner.user_id}`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("vary"), /Authorization/);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-amz-request-id"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.ok(signed_requests >= 2);
  });

  test("미인증·잘못된 UUID·없는 계정·탈퇴 대상·외부 이미지는 저장소 호출 전에 거절", async () => {
    const before = read_count;
    const missing_auth = await fetch(`${base_url}/api/v1/profile-images/${owner.user_id}`);
    assert.equal(missing_auth.status, 401);
    const invalid = await fetch(`${base_url}/api/v1/profile-images/invalid`, { headers: headers() });
    assert.equal(invalid.status, 400);
    const missing = await fetch(`${base_url}/api/v1/profile-images/${crypto.randomUUID()}`, { headers: headers() });
    assert.equal(missing.status, 404);
    const pending = await user({ account_status: "DELETION_PENDING", deletion_requested_at: new Date() });
    assert.equal((await fetch(`${base_url}/api/v1/profile-images/${pending.user_id}`, { headers: headers() })).status, 404);
    assert.equal((await fetch(`${base_url}/api/v1/profile-images/${owner.user_id}`, { headers: headers(pending) })).status, 409);
    const external = await user({ profile_image_url: "https://external.example.test/avatar.png" });
    assert.equal((await fetch(`${base_url}/api/v1/profile-images/${external.user_id}`, { headers: headers() })).status, 404);
    assert.equal(read_count, before);
  });

  test("DB와 읽기 경계는 타인 key·다른 환경·잘못된 경로를 거절", async () => {
    await assert.rejects(viewer.update({ profile_image_key: owner_key }), (error) => error.parent?.code === "23514");
    const cross_env_key = owner_key.replace(/^test\//, "center/");
    await owner.update({ profile_image_key: cross_env_key });
    const before = read_count;
    assert.equal((await fetch(`${base_url}/api/v1/profile-images/${owner.user_id}`, { headers: headers() })).status, 404);
    assert.equal(read_count, before);
    await owner.update({ profile_image_key: owner_key });
    await assert.rejects(updateProfileFields(viewer.user_id, { profile_image_url: owner.profile_image_url }), /파일 업로드/);
  });

  test("원본 AccessDenied는 안전한 503, 삭제 객체는 404이며 S3 응답 원문 미노출", async () => {
    for (const [code, expected_status] of [["AccessDenied", 503], ["NoSuchKey", 404]]) {
      next_error = code;
      const response = await fetch(`${base_url}/api/v1/profile-images/${owner.user_id}`, { headers: headers() });
      assert.equal(response.status, expected_status);
      const text = await response.text();
      assert.doesNotMatch(text, /test-only|amazonaws|AccessDenied|stage\/profiles|test\/profiles/);
    }
  });

  test("실행 가능한 MIME과 과대 원본은 이미지 스트리밍 전에 거절", async () => {
    const object_path = `/profile-private-test/${owner_key}`;
    const original = objects.get(object_path);
    for (const object of [
      { bytes: Buffer.from("<svg><script/></svg>"), type: "image/svg+xml" },
      { bytes: Buffer.alloc(5 * 1024 * 1024 + 1), type: "image/png" },
    ]) {
      objects.set(object_path, object);
      const response = await fetch(`${base_url}/api/v1/profile-images/${owner.user_id}`, { headers: headers() });
      assert.equal(response.status, 503);
      assert.match(response.headers.get("content-type"), /application\/json/);
      assert.equal((await response.json()).error.code, "PROFILE_IMAGE_STORAGE_UNAVAILABLE");
    }
    objects.set(object_path, original);
  });

  test("기존 S3 URL 호환 조회·dry-run·멱등 backfill과 응답 원본 숨김", async () => {
    const legacy = await user();
    const key = `test/profiles/${legacy.user_id}/${crypto.randomUUID()}.png`;
    const old_url = `https://legacy.example.test/${key}`;
    await legacy.update({ profile_image_url: old_url });
    objects.set(`/profile-private-test/${key}`, { bytes: png, type: "image/png" });
    const profile = await fetch(`${base_url}/api/v1/auth/profile`, { headers: headers(legacy) });
    const body = await profile.json();
    assert.equal(body.data.profile_image_url, `https://api.example.test/api/v1/profile-images/${legacy.user_id}`);
    await updateProfileFields(legacy.user_id, { profile_image_url: body.data.profile_image_url });
    await legacy.reload(); assert.equal(legacy.profile_image_url, old_url);
    assert.equal((await fetch(`${base_url}/api/v1/profile-images/${legacy.user_id}`, { headers: headers() })).status, 200);
    assert.equal((await backfillProfileImages(false)).eligible, 1);
    await legacy.reload(); assert.equal(legacy.profile_image_key, null);
    assert.equal((await backfillProfileImages(true)).converted, 1);
    await legacy.reload(); assert.equal(legacy.profile_image_key, key);
    assert.equal(legacy.profile_image_url, body.data.profile_image_url);
    assert.equal((await backfillProfileImages(true)).converted, 0);
    await updateProfileFields(legacy.user_id, { profile_image_url: null });
    await legacy.reload(); assert.equal(legacy.profile_image_key, null);
    assert.equal((await fetch(`${base_url}/api/v1/profile-images/${legacy.user_id}`, { headers: headers() })).status, 404);
  });
}
