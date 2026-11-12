const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");
process.env.PROFILE_IMAGE_STORAGE_BUCKET = "profile-test";
process.env.PROFILE_IMAGE_STORAGE_REGION = "ap-northeast-2";
process.env.PROFILE_IMAGE_STORAGE_PREFIX = "test";
process.env.PROFILE_IMAGE_PUBLIC_BASE_URL = "https://cdn.example.com";
process.env.PROFILE_IMAGE_API_BASE_URL = "https://api.example.test";

const {
  detectProfileImage,
  profile_image_max_bytes,
} = require("../dist/middlewares/profileImageUpload.js");
const {
  deleteProfileImage,
  setProfileImageStorageClientForTest,
  uploadProfileImage,
} = require("../dist/services/profileImageStorageService.js");
const {
  validateProfileImageStorageEnvironment,
} = require("../dist/config/environment.js");

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

const one_pixel_png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("profile image 검증은 실제 PNG 구조를 감지하고 손상·실행 파일을 거부한다", () => {
  const detected = detectProfileImage(one_pixel_png);
  assert.equal(detected.content_type, "image/png");
  assert.equal(detected.extension, "png");
  assert.equal(profile_image_max_bytes, 5 * 1024 * 1024);
  assert.equal(detectProfileImage(one_pixel_png.subarray(0, 20)), null);
  assert.equal(detectProfileImage(Buffer.from("<svg><script/></svg>")), null);
  assert.equal(detectProfileImage(Buffer.from("GIF89a")), null);
});

test("S3 호환 저장소는 UUID key·안정 URL을 만들고 같은 key를 삭제한다", async () => {
  const commands = [];
  setProfileImageStorageClientForTest({
    async send(command) {
      commands.push(command);
      return {};
    },
  });
  const stored = await uploadProfileImage(
    "00000000-0000-4000-8000-000000000001",
    detectProfileImage(one_pixel_png),
  );
  assert.match(
    stored.key,
    /^test\/profiles\/00000000-0000-4000-8000-000000000001\/[0-9a-f-]{36}[.]png$/,
  );
  assert.equal(stored.public_url, "https://api.example.test/api/v1/profile-images/00000000-0000-4000-8000-000000000001");
  assert.equal(commands[0].input.ContentType, "image/png");
  assert.equal(commands[0].input.CacheControl, "private, no-store");
  await deleteProfileImage(stored.key);
  assert.equal(commands[1].input.Key, stored.key);
  setProfileImageStorageClientForTest(null);
});

test("profile storage 환경 검증은 이전 base URL이 있으면 query/hash 없는 HTTPS를 강제한다", () => {
  assert.doesNotThrow(() => validateProfileImageStorageEnvironment());
  const original_prefix = process.env.PROFILE_IMAGE_STORAGE_PREFIX;
  process.env.PROFILE_IMAGE_STORAGE_PREFIX = "stage/profiles";
  assert.throws(
    () => validateProfileImageStorageEnvironment(),
    /PROFILE_IMAGE_STORAGE_PREFIX/,
  );
  process.env.PROFILE_IMAGE_STORAGE_PREFIX = original_prefix;
  const original = process.env.PROFILE_IMAGE_PUBLIC_BASE_URL;
  process.env.PROFILE_IMAGE_PUBLIC_BASE_URL = "http://cdn.example.com/path";
  assert.throws(() => validateProfileImageStorageEnvironment(), /HTTPS URL/);
  process.env.PROFILE_IMAGE_PUBLIC_BASE_URL = original;
});

test("가입·일반 편집 route와 OpenAPI·자유 직종 migration 계약", () => {
  const routes = readRepositoryFile("src/routes/authRoutes.ts");
  const service = readRepositoryFile("src/services/profileService.ts");
  const migration = readRepositoryFile("migrations/add_profile_edit_support.sql");
  const spec = JSON.parse(readRepositoryFile("src/openapi/profileAuthOpenApi.json"));
  for (const route of ["/profile/complete", "/profile"]) {
    const section = routes.slice(routes.indexOf(`  "${route}",`, routes.indexOf("// 가입 프로필")));
    assert.match(section, /authRateLimitMiddleware[\s\S]*authMiddleware[\s\S]*profileImageUploadMiddleware/);
    const post = spec.paths[`/auth${route}`].post;
    assert.ok(post.requestBody.content["application/json"]);
    assert.ok(post.requestBody.content["multipart/form-data"]);
    for (const code of ["200", "400", "401", "409", "413", "429", "503"]) assert.ok(post.responses[code]);
  }
  assert.match(service, /sequelize[.]transaction/);
  assert.match(service, /LOCK[.]UPDATE/);
  assert.match(service, /profile_completed_at == null/);
  assert.match(migration, /char_length\(btrim\(job_type\)\) BETWEEN 1 AND 20/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public[.]profile_image_cleanup_tasks/);
  assert.doesNotMatch(migration, /UPDATE public[.]users|DROP SCHEMA/);
  for (const name of ["ProfileCompleteFields", "ProfileUpdateRequest", "OwnProfile"]) {
    assert.equal(spec.components.schemas[name].properties.job_type.enum, undefined);
    assert.equal(spec.components.schemas[name].properties.job_type.maxLength, 20);
  }
});

test("기존 가입 migration과 비공개 Stage/Center 실행 쿼리 계약", (t) => {
  const private_files = ["add_profile_completion_support.sql", "rollback_profile_completion_support.sql", "stage_profile_completion_apply_pgadmin.sql", "center_profile_completion_apply_pgadmin.sql"];
  const present = private_files.filter((file) => fs.existsSync(path.join(repository_root, "migrations", file)));
  if (present.length === 0) { t.skip("공개 develop checkout에는 기존 가입 배포 SQL을 포함하지 않습니다."); return; }
  assert.equal(present.length, private_files.length, "기존 배포 SQL은 모두 있어야 검증할 수 있습니다.");
  const migration = readRepositoryFile("migrations/add_profile_completion_support.sql");
  const rollback = readRepositoryFile("migrations/rollback_profile_completion_support.sql");
  const stage = readRepositoryFile("migrations/stage_profile_completion_apply_pgadmin.sql");
  const center = readRepositoryFile("migrations/center_profile_completion_apply_pgadmin.sql");
  const spec = JSON.parse(readRepositoryFile("src/openapi/profileAuthOpenApi.json"));

  assert.match(migration, /ADD COLUMN job_type[\s\S]*ADD COLUMN workplace[\s\S]*ADD COLUMN profile_completed_at/);
  assert.ok(
    migration.indexOf("ADD COLUMN job_type") <
      migration.indexOf("ADD CONSTRAINT ck_users_job_type"),
  );
  assert.ok(
    migration.indexOf("ADD CONSTRAINT ck_users_job_type") <
      migration.indexOf("UPDATE public.users"),
  );
  assert.match(migration, /pg_timezone_names/);
  assert.match(rollback, /DROP CONSTRAINT ck_users_job_type/);
  assert.match(rollback, /DROP COLUMN profile_completed_at/);
  assert.match(stage, /shiftmate_stage/);
  assert.match(stage, /APPLY_PROFILE_COMPLETION_TO_STAGE/);
  assert.match(stage, /REPLACE_WITH_ACTUAL_STAGE_BACKUP_FILENAME/);
  assert.match(center, /shiftmate_center/);
  assert.match(center, /APPLY_PROFILE_COMPLETION_TO_CENTER/);
  assert.match(center, /REPLACE_WITH_ACTUAL_CENTER_BACKUP_FILENAME/);
  assert.ok(spec.paths["/auth/profile/complete"].post);
  assert.ok(
    spec.paths["/auth/profile/complete"].post.requestBody.content[
      "multipart/form-data"
    ],
  );
  assert.ok(spec.paths["/auth/profile/complete"].post.responses["413"]);
});

test("OAuth 응답은 is_new_user와 별도로 requires_profile_setup을 제공한다", () => {
  for (const relative_path of [
    "src/openapi/appleAuthOpenApi.json",
    "src/openapi/googleAuthOpenApi.json",
    "src/openapi/kakaoAuthOpenApi.json",
  ]) {
    assert.match(readRepositoryFile(relative_path), /requires_profile_setup/);
  }
  const controller = readRepositoryFile("src/controllers/authController.ts");
  assert.ok((controller.match(/requires_profile_setup:/g) || []).length >= 7);
  const naver_controller = controller.slice(controller.indexOf("async function sendNaverLoginResponse"));
  assert.match(naver_controller, /requires_profile_setup: result\.user\.profile_completed_at == null/);
  assert.equal((naver_controller.match(/await sendNaverLoginResponse\(req, res, identity\)/g) || []).length, 2);
});

test("친구 목록과 그룹 응답 경로는 phone/workplace를 공개하지 않는다", () => {
  const friend_service = readRepositoryFile("src/services/friendService.ts");
  const friend_list_query = friend_service.slice(
    friend_service.indexOf("export async function getFriends"),
    friend_service.indexOf("export async function getFriendCalendarRange"),
  );
  assert.doesNotMatch(friend_list_query, /u[.]phone|workplace/);
  const group_types = readRepositoryFile("src/types/group.ts");
  assert.doesNotMatch(group_types, /phone|workplace/);
});


test("탈퇴 진행 계정의 늦은 이미지 요청은 필드 검증보다 활성 상태 검사를 우선한다", async () => {
  const { User } = require("../dist/models");
  const lock_module = require("../dist/utils/accountDataLock");
  const { mutateProfile } = require("../dist/services/profileMutationService");
  const original_find = User.findByPk;
  const original_lock = lock_module.withAccountDataLock;
  User.findByPk = async () => ({ account_status: "DELETION_PENDING" });
  lock_module.withAccountDataLock = async (_user_id, action) => action();
  try {
    for (const complete of [false, true]) {
      await assert.rejects(
        mutateProfile("00000000-0000-4000-8000-000000000001", { name: null }, detectProfileImage(one_pixel_png), complete),
        (error) => error.code === "UNAUTHORIZED" && error.status_code === 401,
      );
    }
  } finally {
    User.findByPk = original_find;
    lock_module.withAccountDataLock = original_lock;
  }
});
