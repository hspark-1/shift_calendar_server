const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");
process.env.PROFILE_IMAGE_STORAGE_BUCKET = "profile-test";
process.env.PROFILE_IMAGE_STORAGE_REGION = "ap-northeast-2";
process.env.PROFILE_IMAGE_STORAGE_PREFIX = "test";
process.env.PROFILE_IMAGE_PUBLIC_BASE_URL = "https://cdn.example.com";

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
  assert.equal(stored.public_url, `https://cdn.example.com/${stored.key}`);
  assert.equal(commands[0].input.ContentType, "image/png");
  assert.equal(commands[0].input.CacheControl, "public, max-age=31536000, immutable");
  await deleteProfileImage(stored.key);
  assert.equal(commands[1].input.Key, stored.key);
  setProfileImageStorageClientForTest(null);
});

test("profile storage 환경 검증은 query/hash 없는 HTTPS public URL을 강제한다", () => {
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

test("가입 프로필 route·OpenAPI·migration과 Stage/Center 실행 쿼리 계약", () => {
  const routes = readRepositoryFile("src/routes/authRoutes.ts");
  const service = readRepositoryFile("src/services/profileService.ts");
  const migration = readRepositoryFile("migrations/add_profile_completion_support.sql");
  const rollback = readRepositoryFile("migrations/rollback_profile_completion_support.sql");
  const stage = readRepositoryFile("migrations/stage_profile_completion_apply_pgadmin.sql");
  const center = readRepositoryFile("migrations/center_profile_completion_apply_pgadmin.sql");
  const spec = JSON.parse(readRepositoryFile("src/openapi/profileAuthOpenApi.json"));

  assert.match(
    routes,
    /"\/profile\/complete"[\s\S]*authRateLimitMiddleware[\s\S]*authMiddleware[\s\S]*profileImageUploadMiddleware/,
  );
  assert.match(service, /sequelize[.]transaction/);
  assert.match(service, /LOCK[.]UPDATE/);
  assert.match(service, /profile_completed_at == null/);
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
  assert.ok((controller.match(/requires_profile_setup:/g) || []).length >= 8);
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
