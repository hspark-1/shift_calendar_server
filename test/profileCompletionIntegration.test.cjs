const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const allowed = process.env.PROFILE_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const isolated =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

if (process.env.RUN_PROFILE_INTEGRATION !== "true") {
  test("가입 프로필 PostgreSQL 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else if (!allowed || !isolated) {
  test("가입 프로필 통합 테스트는 고정 격리 DB에서만 schema를 초기화한다", () => {
    assert.fail("PROFILE_INTEGRATION_ALLOW_SCHEMA_RESET=true와 고정 격리 DB 연결이 필요합니다.");
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "profile-integration-access-secret";
  process.env.JWT_REFRESH_SECRET = "profile-integration-refresh-secret";
  process.env.PROFILE_IMAGE_STORAGE_BUCKET = "profile-integration";
  process.env.PROFILE_IMAGE_STORAGE_REGION = "ap-northeast-2";
  process.env.PROFILE_IMAGE_STORAGE_PREFIX = "test";
  process.env.PROFILE_IMAGE_PUBLIC_BASE_URL = "https://cdn.example.com";

  const jwt = require("jsonwebtoken");
  const { QueryTypes } = require("sequelize");
  const {
    sequelize,
    connectDatabase,
    disconnectDatabase,
  } = require("../dist/config/database.js");
  const { User } = require("../dist/models/index.js");
  const {
    completeProfile,
    ProfileError,
    updateProfileFields,
  } = require("../dist/services/profileService.js");
  const {
    setProfileImageStorageClientForTest,
  } = require("../dist/services/profileImageStorageService.js");
  const { app } = require("../dist/index.js");

  const repository_root = path.resolve(__dirname, "..");
  const one_pixel_png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let api_server;
  let api_base_url;

  async function loadSql(relative_path) {
    const source = fs
      .readFileSync(path.join(repository_root, relative_path), "utf8")
      .replace(/^\\set .*$/gm, "");
    await sequelize.query(source);
  }

  function accessToken(user) {
    return jwt.sign(
      { user_id: user.user_id, email: user.email, auth_time: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );
  }

  test.before(async () => {
    await connectDatabase();
    await loadSql("test/fixtures/profileCompletionMigrationBaseSchema.sql");
    await loadSql("migrations/add_profile_completion_support.sql");
    await new Promise((resolve) => {
      api_server = app.listen(0, "127.0.0.1", resolve);
    });
    api_base_url = `http://127.0.0.1:${api_server.address().port}`;
  });

  test.after(async () => {
    setProfileImageStorageClientForTest(null);
    if (api_server) {
      await new Promise((resolve, reject) => {
        api_server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
  });

  test("migration은 nullable 컬럼·검증 제약과 정확한 기존 사용자 backfill을 만든다", async () => {
    const columns = await sequelize.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users'
         AND column_name IN ('job_type','workplace','profile_completed_at')
       ORDER BY column_name`,
      { type: QueryTypes.SELECT },
    );
    assert.deepEqual(columns, [
      { column_name: "job_type", data_type: "character varying", character_maximum_length: 20, is_nullable: "YES" },
      { column_name: "profile_completed_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "YES" },
      { column_name: "workplace", data_type: "character varying", character_maximum_length: 100, is_nullable: "YES" },
    ]);
    const users = await sequelize.query(
      `SELECT email, profile_completed_at FROM users ORDER BY email`,
      { type: QueryTypes.SELECT },
    );
    assert.equal(users.find((user) => user.email === "backfill@example.com").profile_completed_at.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(users.find((user) => user.email === "invalid-timezone@example.com").profile_completed_at, null);
    assert.equal(users.find((user) => user.email === "missing-phone@example.com").profile_completed_at, null);
  });

  test("필수값 완료는 trim·정규화하고 같은 요청 재전송 시 완료 시각을 유지한다", async () => {
    const user = await User.create({ email: "complete@example.com", name: "OAuth 이름" });
    const first = await completeProfile(user.user_id, {
      name: "  김간호  ",
      timezone: "Asia/Seoul",
      phone: "01012345678",
    });
    const completed_at = first.profile_completed_at.toISOString();
    assert.equal(first.name, "김간호");
    assert.equal(first.phone, "010-1234-5678");
    assert.equal(first.job_type, null);
    assert.equal(first.workplace, null);
    assert.equal(first.toJSON().requires_profile_setup, false);
    const second = await completeProfile(user.user_id, {
      name: "김간호",
      timezone: "Asia/Seoul",
      phone: "010-1234-5678",
      job_type: "",
      workplace: "   ",
    });
    assert.equal(second.profile_completed_at.toISOString(), completed_at);
  });

  test("선택 근무 정보는 trim 저장되고 일반 수정의 null은 지우되 완료 시각은 만들지 않는다", async () => {
    const completed = await User.create({ email: "work@example.com", name: "초기" });
    const result = await completeProfile(completed.user_id, {
      name: "이의사",
      timezone: "UTC",
      phone: "01099998888",
      job_type: " DOCTOR ",
      workplace: "  제일병원 응급실  ",
    });
    assert.equal(result.job_type, "DOCTOR");
    assert.equal(result.workplace, "제일병원 응급실");
    const incomplete = await User.create({ email: "edit@example.com", name: "편집" });
    const edited = await updateProfileFields(incomplete.user_id, {
      job_type: null,
      workplace: null,
    });
    assert.equal(edited.profile_completed_at, null);
  });

  test("잘못된 필수값·timezone·phone·job type과 중복 번호를 구조화 오류로 거절한다", async () => {
    const user = await User.create({ email: "invalid@example.com", name: "초기" });
    const cases = [
      [{ name: " ", timezone: "UTC", phone: "01033334444" }, "VALIDATION_ERROR"],
      [{ name: "정상", timezone: "Invalid/Timezone", phone: "01033334444" }, "INVALID_TIMEZONE"],
      [{ name: "정상", timezone: "UTC", phone: "123" }, "INVALID_PHONE"],
      [{ name: "정상", timezone: "UTC", phone: "01033334444", job_type: "PILOT" }, "INVALID_JOB_TYPE"],
    ];
    for (const [input, code] of cases) {
      await assert.rejects(
        completeProfile(user.user_id, input),
        (error) => error instanceof ProfileError && error.code === code,
      );
    }
    await assert.rejects(
      completeProfile(user.user_id, { name: "정상", timezone: "UTC", phone: "01011112222" }),
      (error) => error instanceof ProfileError && error.code === "PHONE_ALREADY_EXISTS" && error.status_code === 409,
    );
  });

  test("DB 저장 실패는 필수 필드와 완료 시각을 함께 rollback한다", async () => {
    const user = await User.create({ email: "rollback-profile@example.com", name: "기존 이름" });
    await sequelize.query(`ALTER TABLE users ADD CONSTRAINT ck_profile_test_failure CHECK (name <> 'FORCE_TX_FAILURE')`);
    try {
      await assert.rejects(
        completeProfile(user.user_id, {
          name: "FORCE_TX_FAILURE",
          timezone: "UTC",
          phone: "01044445555",
        }),
      );
      await user.reload();
      assert.equal(user.name, "기존 이름");
      assert.equal(user.phone, null);
      assert.equal(user.profile_completed_at, null);
    } finally {
      await sequelize.query(`ALTER TABLE users DROP CONSTRAINT ck_profile_test_failure`);
    }
  });

  test("multipart MIME 불일치·5MB 초과를 거절하고 DB 실패 시 업로드 object를 삭제한다", async () => {
    const user = await User.create({ email: "multipart@example.com", name: "업로드" });
    const token = accessToken(user);
    const mismatched_form = new FormData();
    mismatched_form.set("name", "업로드 사용자");
    mismatched_form.set("timezone", "UTC");
    mismatched_form.set("phone", "01055556666");
    mismatched_form.set("profile_image", new Blob([one_pixel_png], { type: "image/jpeg" }), "profile.jpg");
    const mismatched = await fetch(`${api_base_url}/api/v1/auth/profile/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: mismatched_form,
    });
    assert.equal(mismatched.status, 400);
    assert.equal((await mismatched.json()).error.code, "INVALID_PROFILE_IMAGE");

    const oversized_form = new FormData();
    oversized_form.set("name", "업로드 사용자");
    oversized_form.set("timezone", "UTC");
    oversized_form.set("phone", "01055556666");
    oversized_form.set("profile_image", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
    const oversized = await fetch(`${api_base_url}/api/v1/auth/profile/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: oversized_form,
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "PROFILE_IMAGE_TOO_LARGE");

    const commands = [];
    setProfileImageStorageClientForTest({
      async send(command) {
        commands.push(command);
        return {};
      },
    });
    await sequelize.query(`ALTER TABLE users ADD CONSTRAINT ck_profile_image_db_failure CHECK (name <> 'IMAGE_DB_FAILURE')`);
    try {
      const cleanup_form = new FormData();
      cleanup_form.set("name", "IMAGE_DB_FAILURE");
      cleanup_form.set("timezone", "UTC");
      cleanup_form.set("phone", "01055556666");
      cleanup_form.set("profile_image", new Blob([one_pixel_png], { type: "image/png" }), "profile.png");
      const failed = await fetch(`${api_base_url}/api/v1/auth/profile/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: cleanup_form,
      });
      assert.equal(failed.status, 500);
      assert.equal(commands.length, 2);
      assert.equal(commands[0].input.Key, commands[1].input.Key);
    } finally {
      await sequelize.query(`ALTER TABLE users DROP CONSTRAINT ck_profile_image_db_failure`);
    }

    const success_form = new FormData();
    success_form.set("name", "업로드 성공");
    success_form.set("timezone", "UTC");
    success_form.set("phone", "01055556666");
    success_form.set("profile_image", new Blob([one_pixel_png], { type: "image/png" }), "profile.png");
    const success = await fetch(`${api_base_url}/api/v1/auth/profile/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: success_form,
    });
    assert.equal(success.status, 200);
    const success_body = await success.json();
    assert.equal(success_body.data.requires_profile_setup, false);
    assert.match(success_body.data.profile_image_url, /^https:\/\/cdn[.]example[.]com\/test\/profiles\//);

    const storage_failure_user = await User.create({ email: "storage-failure@example.com", name: "저장 실패" });
    setProfileImageStorageClientForTest({
      async send() {
        throw new Error("object storage unavailable");
      },
    });
    const storage_failure_form = new FormData();
    storage_failure_form.set("name", "저장 실패 사용자");
    storage_failure_form.set("timezone", "UTC");
    storage_failure_form.set("phone", "01066667777");
    storage_failure_form.set("profile_image", new Blob([one_pixel_png], { type: "image/png" }), "profile.png");
    const storage_failure = await fetch(`${api_base_url}/api/v1/auth/profile/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken(storage_failure_user)}` },
      body: storage_failure_form,
    });
    assert.equal(storage_failure.status, 503);
    assert.equal((await storage_failure.json()).error.code, "PROFILE_IMAGE_STORAGE_UNAVAILABLE");
    await storage_failure_user.reload();
    assert.equal(storage_failure_user.profile_completed_at, null);
    assert.equal(storage_failure_user.profile_image_url, null);
  });

  test("승인형 down migration은 신규 제약과 세 컬럼만 제거한다", async () => {
    const rollback = fs
      .readFileSync(
        path.join(repository_root, "migrations", "rollback_profile_completion_support.sql"),
        "utf8",
      )
      .replace(/^\\.*$/gm, "")
      .replace(/:'expected_database'/g, `'${process.env.DB_NAME}'`)
      .replace(/:confirm_profile_completion_support_drop/g, "true");
    const transaction_start = rollback.indexOf("BEGIN;");
    await sequelize.query(rollback.slice(transaction_start));
    const remaining = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users'
         AND column_name IN ('job_type','workplace','profile_completed_at')`,
      { type: QueryTypes.SELECT },
    );
    assert.deepEqual(remaining, []);
    const phone = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='users' AND column_name='phone'`,
      { type: QueryTypes.SELECT },
    );
    assert.equal(phone.length, 1);
  });

  test("Stage와 Center pgAdmin 단일 실행 쿼리는 PostgreSQL 16에서 끝까지 commit된다", async () => {
    const wrapper_cases = [
      {
        file_name: "stage_profile_completion_apply_pgadmin.sql",
        database_name: "shiftmate_stage",
        backup_placeholder: "REPLACE_WITH_ACTUAL_STAGE_BACKUP_FILENAME",
        backup_name: "profile_stage_20260820.backup",
      },
      {
        file_name: "center_profile_completion_apply_pgadmin.sql",
        database_name: "shiftmate_center",
        backup_placeholder: "REPLACE_WITH_ACTUAL_CENTER_BACKUP_FILENAME",
        backup_name: "profile_center_20260820.backup",
      },
    ];

    for (const wrapper_case of wrapper_cases) {
      await loadSql("test/fixtures/profileCompletionMigrationBaseSchema.sql");
      const wrapper = fs
        .readFileSync(
          path.join(repository_root, "migrations", wrapper_case.file_name),
          "utf8",
        )
        .replaceAll(wrapper_case.database_name, process.env.DB_NAME)
        .replace(
          wrapper_case.backup_placeholder,
          wrapper_case.backup_name,
        );
      await sequelize.query(wrapper);
      const [result] = await sequelize.query(
        `SELECT count(*) FILTER (WHERE profile_completed_at IS NOT NULL)::integer AS completed,
                count(*) FILTER (WHERE profile_completed_at IS NULL)::integer AS incomplete
         FROM users`,
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(result, { completed: 1, incomplete: 2 });
    }
  });
}
