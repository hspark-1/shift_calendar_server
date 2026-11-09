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
  const { enqueueProfileImageCleanup, processProfileImageCleanupBatch } = require("../dist/services/profileImageCleanupService");
  const { withAccountDataLock } = require("../dist/utils/accountDataLock");
  const { processAccountDeletionRequest } = require("../dist/workers/accountDeletionWorker");
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
  let fail_put = false;
  let fail_delete = false;
  let put_gate;
  function sql(file) { return fs.readFileSync(file, "utf8").split("\n").filter((line) => !line.startsWith("\\")).join("\n"); }
  async function user(extra = {}) { return User.create({ email: `${crypto.randomUUID()}@example.test`, name: "이미지 사용자", ...extra }); }
  function token(current_user) { return jwt.sign({ user_id: current_user.user_id, email: current_user.email, auth_time: Math.floor(Date.now() / 1000) }, process.env.JWT_SECRET, { expiresIn: "5m" }); }
  function headers(current_user = viewer) { return { Authorization: `Bearer ${token(current_user)}` }; }
  async function listen(server) { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); return server.address().port; }
  function imageForm(fields = {}) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("profile_image", new Blob([png], { type: "image/png" }), "p.png");
    return form;
  }
  async function edit(current_user, body) {
    const multipart = body instanceof FormData;
    const response = await fetch(`${base_url}/api/v1/auth/profile`, { method: "POST",
      headers: { ...headers(current_user), ...(!multipart ? { "Content-Type": "application/json" } : {}) },
      body: multipart ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function tasks(current_user) {
    const [rows] = await sequelize.query("SELECT * FROM profile_image_cleanup_tasks WHERE owner_user_id=:user_id", { replacements: { user_id: current_user.user_id } });
    return rows;
  }
  function objectKeys(current_user) { return [...objects.keys()].filter((key) => key.includes(`/profiles/${current_user.user_id}/`)); }

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
        if (put_gate) { put_gate.started(); await put_gate.pending; }
        if (fail_put) { res.writeHead(503, { "Content-Type": "application/xml" }); res.end("<Error><Code>ServiceUnavailable</Code></Error>"); return; }
        objects.set(object_path, { bytes: Buffer.concat(chunks), type: req.headers["content-type"] });
        res.writeHead(200, { ETag: '"test-object"' }); res.end(); return;
      }
      if (req.method === "DELETE") {
        if (fail_delete) { res.writeHead(503, { "Content-Type": "application/xml" }); res.end("<Error><Code>ServiceUnavailable</Code></Error>"); return; }
        objects.delete(object_path); res.writeHead(204); res.end(); return;
      }
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

  test("후속 migration은 기존 코드를 보존하고 자유 직종 CHECK·정리 큐를 멱등 추가한다", async () => {
    const existing = await user({ job_type: "NURSE" });
    await sequelize.query("ALTER TABLE users DROP CONSTRAINT ck_users_job_type; ALTER TABLE users ADD CONSTRAINT ck_users_job_type CHECK (job_type IS NULL OR job_type IN ('NURSE','DOCTOR','EMT','OTHER'))");
    await assert.rejects(sequelize.query("UPDATE users SET job_type='서비스 기획자' WHERE user_id=:id", { replacements: { id: existing.user_id } }));
    await sequelize.query(sql("migrations/add_profile_edit_support.sql"));
    await sequelize.query(sql("migrations/add_profile_edit_support.sql"));
    await existing.reload(); assert.equal(existing.job_type, "NURSE");
    await existing.update({ job_type: "서비스 기획자" });
    for (const value of ["", " ", "X".repeat(21)]) {
      await assert.rejects(sequelize.query("UPDATE users SET job_type=:value WHERE user_id=:id", { replacements: { value, id: existing.user_id } }));
    }
  });

  test("JSON 부분 수정은 생략값·사진·완료 시각을 보존하며 내부 필드는 무시한다", async () => {
    const completed_at = new Date("2026-01-01T00:00:00Z");
    const current = await user({ phone: "010-7777-1111", timezone: "Asia/Seoul", job_type: "NURSE", workplace: "병원", profile_completed_at: completed_at, profile_image_url: "https://oauth.example.test/p.jpg" });
    const edited = await edit(current, { name: " 새 이름 ", user_id: viewer.user_id, email: "forged@example.test", profile_image_key: owner_key, profile_completed_at: null });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.name, "새 이름");
    assert.equal(edited.body.data.phone, current.phone);
    assert.equal(edited.body.data.timezone, current.timezone);
    assert.equal(edited.body.data.job_type, current.job_type);
    assert.equal(edited.body.data.workplace, current.workplace);
    assert.equal(edited.body.data.profile_image_url, current.profile_image_url);
    assert.equal(edited.body.data.user_id, current.user_id);
    assert.equal(edited.body.data.email, current.email);
    assert.equal(edited.body.data.requires_profile_setup, false);
    assert.equal(edited.body.data.profile_image_key, undefined);
    assert.equal(edited.body.data.profile_completed_at, undefined);
    assert.ok(edited.body.request_id);
    await current.reload(); assert.equal(current.profile_completed_at.toISOString(), completed_at.toISOString());
    const incomplete = await user();
    assert.equal((await edit(incomplete, { name: "미완료 수정" })).body.data.requires_profile_setup, true);
    await incomplete.reload(); assert.equal(incomplete.profile_completed_at, null);
  });

  test("자유 직종·선택값 삭제·문자열 null과 자료형/길이 경계를 JSON/multipart에 적용한다", async () => {
    const current = await user();
    for (const job_type of [" 서비스 기획자 ", "NURSE", "DOCTOR", "EMT", "OTHER", "😀".repeat(20), "null"]) {
      const response = await edit(current, { job_type, workplace: " 소속 " });
      assert.equal(response.status, 200); assert.equal(response.body.data.job_type, job_type.trim());
    }
    for (const value of [null, "", "   "]) {
      const response = await edit(current, { job_type: value, workplace: value });
      assert.equal(response.status, 200); assert.equal(response.body.data.job_type, null); assert.equal(response.body.data.workplace, null);
    }
    for (const [input, code] of [[{ name: null }, "VALIDATION_ERROR"], [{ name: " " }, "VALIDATION_ERROR"], [{ name: "X".repeat(51) }, "VALIDATION_ERROR"], [{ job_type: 1 }, "INVALID_JOB_TYPE"], [{ job_type: [] }, "INVALID_JOB_TYPE"], [{ job_type: "X".repeat(21) }, "INVALID_JOB_TYPE"], [{ workplace: {} }, "VALIDATION_ERROR"], [{ workplace: "X".repeat(101) }, "VALIDATION_ERROR"], [{ phone: "123" }, "INVALID_PHONE"], [{ timezone: "Invalid/Timezone" }, "INVALID_TIMEZONE"]]) {
      const response = await edit(current, input); assert.equal(response.status, 400); assert.equal(response.body.error.code, code);
    }
    const result = await edit(current, imageForm({ job_type: "", workplace: "  " }));
    assert.equal(result.status, 200); assert.equal(result.body.data.job_type, null); assert.equal(result.body.data.workplace, null);
  });

  test("사진 단독·사진+부분 수정은 새 UUID로 교체하고 이전 관리 객체를 삭제한다", async () => {
    const current = await user({ timezone: "UTC", phone: "010-7777-2222" });
    assert.equal((await edit(current, imageForm())).status, 200);
    await current.reload(); const first_key = current.profile_image_key;
    const result = await edit(current, imageForm({ name: "사진 수정", job_type: "기획자" }));
    assert.equal(result.status, 200); assert.equal(result.body.data.timezone, "UTC"); assert.equal(result.body.data.phone, "010-7777-2222");
    assert.equal(result.body.data.requires_profile_setup, true);
    await current.reload(); assert.notEqual(current.profile_image_key, first_key);
    assert.deepEqual(objectKeys(current), [`/profile-private-test/${current.profile_image_key}`]);
    assert.deepEqual(await tasks(current), []);
    const response = await fetch(`${base_url}/api/v1/profile-images/${current.user_id}`, { headers: headers() });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  });

  test("가입 필수값 검증·자유 직종과 일반 사진 교체의 완료 시각 불변을 함께 유지한다", async () => {
    const current = await user();
    const invalid = await fetch(`${base_url}/api/v1/auth/profile/complete`, { method: "POST", headers: headers(current), body: imageForm() });
    assert.equal(invalid.status, 400); assert.deepEqual(objectKeys(current), []);
    const completed = await fetch(`${base_url}/api/v1/auth/profile/complete`, { method: "POST", headers: headers(current), body: imageForm({ name: "가입", phone: "01088886666", timezone: "Asia/Seoul", job_type: "서비스 기획자" }) });
    assert.equal(completed.status, 200); assert.equal((await completed.json()).data.requires_profile_setup, false);
    await current.reload(); const completed_at = current.profile_completed_at.toISOString();
    const edited = await edit(current, imageForm()); assert.equal(edited.body.data.requires_profile_setup, false);
    await current.reload(); assert.equal(current.profile_completed_at.toISOString(), completed_at); assert.equal(current.job_type, "서비스 기획자");
    assert.equal(objectKeys(current).length, 1);
  });

  test("이미지/URL 동시 입력·파일 MIME/내용/개수/part/크기·미인증을 저장 전에 거절한다", async () => {
    const current = await user();
    for (const value of ["", "null", "https://evil.example.test/p.jpg"]) {
      const result = await edit(current, imageForm({ profile_image_url: value }));
      assert.equal(result.status, 400); assert.equal(result.body.error.code, "VALIDATION_ERROR");
    }
    for (const [bytes, type] of [[png, "image/jpeg"], [png.subarray(0, 20), "image/png"], [Buffer.from("GIF89a"), "image/gif"]]) {
      const form = new FormData(); form.set("profile_image", new Blob([bytes], { type }), "p");
      const result = await edit(current, form); assert.equal(result.status, 400); assert.equal(result.body.error.code, "INVALID_PROFILE_IMAGE");
    }
    for (const name of ["profile_image", "wrong_part"]) {
      const form = imageForm(); form.append(name, new Blob([png], { type: "image/png" }), "second.png");
      assert.equal((await edit(current, form)).body.error.code, "INVALID_PROFILE_IMAGE");
    }
    const large = new FormData(); large.set("profile_image", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
    const result = await edit(current, large); assert.equal(result.status, 413); assert.equal(result.body.error.code, "PROFILE_IMAGE_TOO_LARGE");
    assert.equal((await fetch(`${base_url}/api/v1/auth/profile`, { method: "POST", body: imageForm() })).status, 401);
    const arbitrary_url = await edit(current, { profile_image_url: "https://evil.example.test/p.jpg" });
    assert.equal(arbitrary_url.body.error.code, "INVALID_PROFILE_IMAGE");
    assert.deepEqual(objectKeys(current), []); assert.deepEqual(await tasks(current), []);
  });

  test("전화 중복·DB rollback·storage 실패에서 기존 프로필/사진을 유지하고 새 파일만 정리한다", async () => {
    const current = await user(); await edit(current, imageForm()); await current.reload(); const original_key = current.profile_image_key;
    const occupied = await user({ phone: "010-7777-3333" });
    const conflict = await edit(current, imageForm({ phone: occupied.phone }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "PHONE_ALREADY_EXISTS");
    await sequelize.query("ALTER TABLE users ADD CONSTRAINT ck_edit_test_failure CHECK (name <> 'EDIT_DB_FAILURE')");
    try {
      assert.equal((await edit(current, imageForm({ name: "EDIT_DB_FAILURE" }))).status, 500);
    } finally { await sequelize.query("ALTER TABLE users DROP CONSTRAINT ck_edit_test_failure"); }
    fail_put = true;
    try {
      const result = await edit(current, imageForm({ name: "저장 실패" }));
      assert.equal(result.status, 503); assert.equal(result.body.error.code, "PROFILE_IMAGE_STORAGE_UNAVAILABLE");
    } finally { fail_put = false; }
    await current.reload(); assert.equal(current.profile_image_key, original_key); assert.equal(current.name, "이미지 사용자");
    assert.deepEqual(objectKeys(current), [`/profile-private-test/${original_key}`]); assert.deepEqual(await tasks(current), []);
  });

  test("commit 후 삭제 실패는 200·현재 사진 보존, 영속 큐를 worker가 재시도한다", async () => {
    const current = await user(); await edit(current, imageForm()); await current.reload(); const previous_key = current.profile_image_key;
    fail_delete = true;
    try { assert.equal((await edit(current, imageForm({ name: "commit 성공" }))).status, 200); }
    finally { fail_delete = false; }
    await current.reload(); const latest_key = current.profile_image_key;
    assert.notEqual(latest_key, previous_key); assert.equal(objectKeys(current).length, 2);
    assert.equal((await tasks(current))[0].object_key, previous_key);
    assert.equal((await tasks(current))[0].last_error_code, "PROFILE_IMAGE_CLEANUP_RETRY");
    await sequelize.query("UPDATE profile_image_cleanup_tasks SET next_attempt_at=now() WHERE owner_user_id=:id", { replacements: { id: current.user_id } });
    await processProfileImageCleanupBatch();
    assert.deepEqual(objectKeys(current), [`/profile-private-test/${latest_key}`]); assert.deepEqual(await tasks(current), []);
    // 커밋 응답 유실로 현재 key 작업이 남아도 현재 사진을 삭제하지 않는다.
    await enqueueProfileImageCleanup(current.user_id, latest_key);
    await processProfileImageCleanupBatch();
    assert.deepEqual(objectKeys(current), [`/profile-private-test/${latest_key}`]); assert.deepEqual(await tasks(current), []);
  });

  test("전화번호 unique 동시 경쟁은 한 요청만 성공하고 패자 새 사진을 정리한다", async () => {
    const users = await Promise.all([user(), user()]);
    const ids = new Set(users.map((item) => item.user_id));
    let arrived = 0; let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    User.addHook("beforeSave", "profile-phone-race", async (saving) => {
      if (!ids.has(saving.user_id) || saving.phone !== "010-7777-4444") return;
      arrived += 1; if (arrived === 2) release();
      await barrier;
    });
    try {
      const results = await Promise.all(users.map((item) => edit(item, imageForm({ phone: "01077774444" }))));
      assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
      assert.equal(results.find((item) => item.status === 409).body.error.code, "PHONE_ALREADY_EXISTS");
      assert.equal(users.reduce((count, item) => count + objectKeys(item).length, 0), 1);
      for (const item of users) assert.deepEqual(await tasks(item), []);
    } finally { User.removeHook("beforeSave", "profile-phone-race"); }
  });

  test("DB 실패 후 새 객체 삭제도 실패하면 큐를 보존하고 설정 변경 시 오삭제를 막는다", async () => {
    const current = await user();
    await edit(current, imageForm()); await current.reload(); const previous_key = current.profile_image_key;
    const occupied = await user({ phone: "010-7777-5555" });
    fail_delete = true;
    try { assert.equal((await edit(current, imageForm({ phone: occupied.phone }))).status, 409); }
    finally { fail_delete = false; }
    const [pending] = await tasks(current);
    assert.notEqual(pending.object_key, previous_key); assert.equal(objectKeys(current).length, 2);
    await sequelize.query("UPDATE profile_image_cleanup_tasks SET next_attempt_at=now() WHERE owner_user_id=:id", { replacements: { id: current.user_id } });
    const bucket = process.env.PROFILE_IMAGE_STORAGE_BUCKET;
    process.env.PROFILE_IMAGE_STORAGE_BUCKET = "changed-test-bucket";
    try { await processProfileImageCleanupBatch(); assert.equal(objectKeys(current).length, 2); assert.equal((await tasks(current)).length, 1); }
    finally { process.env.PROFILE_IMAGE_STORAGE_BUCKET = bucket; }
    await sequelize.query("UPDATE profile_image_cleanup_tasks SET next_attempt_at=now() WHERE owner_user_id=:id", { replacements: { id: current.user_id } });
    await processProfileImageCleanupBatch();
    assert.deepEqual(objectKeys(current), [`/profile-private-test/${previous_key}`]); assert.deepEqual(await tasks(current), []);
  });

  test("commit 이후 lock 정리 예외는 저장 성공과 새 사진을 보존한다", async () => {
    const current = await user();
    const lock_module = require("../dist/utils/accountDataLock");
    const original = lock_module.withAccountDataLock;
    lock_module.withAccountDataLock = async (id, action) => {
      await original(id, action);
      throw new Error("TEST_LOCK_RELEASE_FAILURE");
    };
    try {
      const result = await edit(current, imageForm({ name: "확정된 프로필" }));
      assert.equal(result.status, 200); assert.equal(result.body.data.name, "확정된 프로필");
    } finally { lock_module.withAccountDataLock = original; }
    await current.reload(); assert.deepEqual(objectKeys(current), [`/profile-private-test/${current.profile_image_key}`]);
    assert.deepEqual(await tasks(current), []);
  });

  test("업로드 후 프로세스 중단을 모의한 선기록 큐는 계정 삭제 뒤에도 고아 객체를 정리한다", async () => {
    const current = await user(); const key = `test/profiles/${current.user_id}/${crypto.randomUUID()}.png`;
    await enqueueProfileImageCleanup(current.user_id, key, "orphan-recovery-test");
    objects.set(`/profile-private-test/${key}`, { bytes: png, type: "image/png" });
    await current.destroy();
    await processProfileImageCleanupBatch();
    assert.deepEqual(objectKeys(current), []); assert.deepEqual(await tasks(current), []);
  });

  test("검증된 legacy 소유 key만 정리하고 외부 OAuth URL은 삭제하지 않는다", async () => {
    const legacy = await user(); const key = `test/profiles/${legacy.user_id}/${crypto.randomUUID()}.png`;
    await legacy.update({ profile_image_url: `https://legacy.example.test/${key}` });
    objects.set(`/profile-private-test/${key}`, { bytes: png, type: "image/png" });
    assert.equal((await edit(legacy, imageForm())).status, 200); assert.equal(objectKeys(legacy).length, 1);
    assert.equal(objects.has(`/profile-private-test/${key}`), false);
    const external = await user({ profile_image_url: "https://oauth.example.test/p.jpg" });
    assert.equal((await edit(external, imageForm())).status, 200); assert.deepEqual(await tasks(external), []);
  });

  test("동시 교체는 계정 lock으로 차단 후 재시도하며 업로드 동안 DB transaction을 열지 않는다", async () => {
    const current = await user();
    let started; let release;
    const waiting = new Promise((resolve) => { started = resolve; });
    put_gate = { started, pending: new Promise((resolve) => { release = resolve; }) };
    const first = edit(current, imageForm());
    try {
      await waiting;
      const [transactions] = await sequelize.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'");
      assert.equal(transactions[0].count, 0);
      assert.equal((await edit(current, imageForm())).status, 503);
      assert.equal((await edit(current, { name: "동시 텍스트 수정" })).status, 200);
      await assert.rejects(withAccountDataLock(current.user_id, async () => {}), /ACCOUNT_DATA_BUSY/);
    } finally { release(); put_gate = undefined; }
    assert.equal((await first).status, 200);
    await current.reload(); assert.equal(current.name, "동시 텍스트 수정");
    assert.equal((await edit(current, imageForm())).status, 200);
    assert.equal(objectKeys(current).length, 1);
  });

  test("업로드 중 탈퇴 접수 후 활성 상태 재검사로 새 파일을 정리하고 재요청을 차단한다", async () => {
    const current = await user();
    let started; let release;
    const waiting = new Promise((resolve) => { started = resolve; });
    put_gate = { started, pending: new Promise((resolve) => { release = resolve; }) };
    const editing = edit(current, imageForm());
    process.env.ACCOUNT_DELETION_ENABLED = "true";
    try {
      await waiting;
      const response = await fetch(`${base_url}/api/v1/auth/account`, { method: "DELETE", headers: { ...headers(current), "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: true }) });
      assert.equal(response.status, 202);
      const receipt = await response.json();
      await assert.rejects(processAccountDeletionRequest(receipt.data.deletion_request_id), /ACCOUNT_DATA_BUSY/);
    } finally { release(); put_gate = undefined; process.env.ACCOUNT_DELETION_ENABLED = "false"; }
    assert.equal((await editing).status, 401);
    assert.deepEqual(objectKeys(current), []); assert.deepEqual(await tasks(current), []);
    assert.equal((await edit(current, imageForm())).body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
    await current.destroy();
    assert.equal((await edit(current, imageForm())).status, 401);
  });
}
