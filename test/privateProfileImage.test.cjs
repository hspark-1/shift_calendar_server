const assert = require("node:assert/strict");
const test = require("node:test");
Object.assign(process.env, {
  NODE_ENV: "test", PROFILE_IMAGE_STORAGE_PREFIX: "stage",
  PROFILE_IMAGE_STORAGE_BUCKET: "private-example", PROFILE_IMAGE_STORAGE_REGION: "ap-northeast-2",
  PROFILE_IMAGE_PUBLIC_BASE_URL: "https://private-example.s3.ap-northeast-2.amazonaws.com",
  PROFILE_IMAGE_API_BASE_URL: "https://api.example.test",
});
const { legacyProfileImageKey, isOwnedProfileImageKey, profileImageJsonReplacer } = require("../dist/utils/profileImageLocation");
const { validateProfileImageApiEnvironment } = require("../dist/config/environment");
const user_id = "00000000-0000-4000-8000-000000000001";
const other_id = "00000000-0000-4000-8000-000000000002";
const key = `stage/profiles/${user_id}/${other_id}.jpg`;
const original_url = `${process.env.PROFILE_IMAGE_PUBLIC_BASE_URL}/${key}`;

test("기존 URL은 정확한 origin·환경·소유자·UUID 경로만 관리 key로 인정한다", () => {
  assert.equal(legacyProfileImageKey(original_url, user_id), key);
  assert.equal(legacyProfileImageKey(original_url, other_id), null);
  for (const url of [original_url.replace("/stage/", "/center/"), `${original_url}?token=x`,
    original_url.replace(".amazonaws.com/", ".amazonaws.com.evil.test/"),
    original_url.replace("/profiles/", "/profiles/../"), original_url.replace(".jpg", ".svg"),
    original_url.replace("stage/profiles", "stage%2fprofiles")]) {
    assert.equal(legacyProfileImageKey(url, user_id), null);
  }
  assert.equal(isOwnedProfileImageKey(key, other_id), false);
});

test("ORM·raw SQL·중첩 알림 JSON은 관리 원본과 key를 노출하지 않는다", () => {
  const result = JSON.parse(JSON.stringify({ user: { profile_image_url: original_url, profile_image_key: key },
    notifications: [{ payload: { profile_image_url: original_url } }],
    external: { profile_image_url: "https://avatar.example.test/p.jpg" },
    invalid: { profile_image_url: original_url.replace("/stage/", "/center/") },
  }, profileImageJsonReplacer));
  const expected_url = `https://api.example.test/api/v1/profile-images/${user_id}`;
  assert.deepEqual(result.user, { profile_image_url: expected_url });
  assert.equal(result.notifications[0].payload.profile_image_url, expected_url);
  assert.equal(result.external.profile_image_url, "https://avatar.example.test/p.jpg");
  assert.equal(result.invalid.profile_image_url, null);
  assert.doesNotMatch(JSON.stringify(result), /amazonaws|stage\/profiles/);
});

test("공개 API origin은 HTTPS·경로 없는 서버 origin만 허용하고 production에서 필수다", () => {
  assert.doesNotThrow(validateProfileImageApiEnvironment);
  for (const value of ["http://api.example.test", "https://api.example.test/path", "https://api.example.test?x=1", "https://u:p@api.example.test"]) {
    process.env.PROFILE_IMAGE_API_BASE_URL = value;
    assert.throws(validateProfileImageApiEnvironment);
  }
  delete process.env.PROFILE_IMAGE_API_BASE_URL;
  assert.doesNotThrow(validateProfileImageApiEnvironment);
  process.env.NODE_ENV = "production";
  assert.throws(validateProfileImageApiEnvironment, /HTTPS origin/);
  process.env.NODE_ENV = "test";
  process.env.PROFILE_IMAGE_API_BASE_URL = "https://api.example.test";
});
