const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  getInclusiveDateRangeDays,
  hasGroupPermission,
  isValidIanaTimezone,
  normalizeGroupName,
  normalizeGroupTimezone,
} = require("../dist/services/groupService.js");
const {
  formatDbDate,
  formatDbTime,
  formatShiftTypeColor,
} = require("../dist/utils/calendarSerialization.js");
const {
  group_error_http_map,
} = require("../dist/controllers/groupController.js");

const local_migration_files = [
  "migrations/add_group_feature.sql",
  "migrations/rollback_group_feature.sql",
  "migrations/stage_group_feature_preflight.sql",
  "migrations/stage_apply_group_feature.sql",
  "migrations/stage_group_feature_postflight.sql",
  "migrations/pgadmin_stage_add_group_feature.sql",
];
const present_local_migration_files = local_migration_files.filter(
  (relative_path) => fs.existsSync(path.join(__dirname, "..", relative_path)),
);

function assertLocalMigrationSetComplete() {
  assert.equal(
    present_local_migration_files.length,
    local_migration_files.length,
    `그룹 migration 로컬 산출물이 일부만 존재합니다. expected=${local_migration_files.join(",")} present=${present_local_migration_files.join(",")}`,
  );
}

test("그룹 이름은 trim 후 1~50자만 허용한다", () => {
  assert.equal(normalizeGroupName("  우리 병동  "), "우리 병동");
  assert.equal(normalizeGroupName("😀".repeat(50)), "😀".repeat(50));
  assert.throws(() => normalizeGroupName("   "), /INVALID_GROUP_NAME/);
  assert.throws(() => normalizeGroupName("가".repeat(51)), /INVALID_GROUP_NAME/);
  assert.throws(() => normalizeGroupName("😀".repeat(51)), /INVALID_GROUP_NAME/);
});

test("IANA timezone을 검증하고 Asia/Seoul을 허용한다", () => {
  assert.equal(isValidIanaTimezone("Asia/Seoul"), true);
  assert.equal(isValidIanaTimezone("UTC"), true);
  assert.equal(isValidIanaTimezone("Not/A_Timezone"), false);
  assert.equal(normalizeGroupTimezone("Asia/Seoul"), "Asia/Seoul");
  assert.throws(
    () => normalizeGroupTimezone("Asia/Invalid"),
    /INVALID_GROUP_TIMEZONE/,
  );
});

test("날짜 범위는 양 끝 포함이며 윤년과 월 경계를 계산한다", () => {
  assert.equal(getInclusiveDateRangeDays("2028-02-29", "2028-02-29"), 1);
  assert.equal(getInclusiveDateRangeDays("2028-02-28", "2028-03-01"), 3);
  assert.equal(getInclusiveDateRangeDays("2026-06-01", "2026-09-08"), 100);
  assert.throws(
    () => getInclusiveDateRangeDays("2026-02-30", "2026-03-01"),
    /INVALID_DATE_RANGE/,
  );
  assert.throws(
    () => getInclusiveDateRangeDays("2026-03-02", "2026-03-01"),
    /INVALID_DATE_RANGE/,
  );
});

test("그룹 역할 매트릭스가 OWNER/ADMIN/MEMBER 경계를 지킨다", () => {
  assert.equal(hasGroupPermission("MEMBER", "VIEW"), true);
  assert.equal(hasGroupPermission("MEMBER", "UPDATE"), false);
  assert.equal(hasGroupPermission("ADMIN", "INVITE"), true);
  assert.equal(hasGroupPermission("ADMIN", "REMOVE_MEMBER", "MEMBER"), true);
  assert.equal(hasGroupPermission("ADMIN", "REMOVE_MEMBER", "ADMIN"), false);
  assert.equal(hasGroupPermission("OWNER", "CHANGE_ROLE"), true);
  assert.equal(hasGroupPermission("ADMIN", "TRANSFER_OWNER"), false);
});

test("캘린더 날짜·시간·색상 직렬화 계약을 유지한다", () => {
  assert.equal(formatDbDate("2026-07-29"), "2026-07-29");
  assert.equal(formatDbTime("07:00"), "07:00:00");
  assert.equal(formatDbTime("07:00:00.000"), "07:00:00");
  assert.equal(formatShiftTypeColor("#FF9500"), "#FFFF9500");
  assert.equal(formatShiftTypeColor("#80FF9500"), "#80FF9500");
  assert.equal(formatShiftTypeColor("invalid"), null);
});

test("OpenAPI는 실제 그룹 path와 개인정보 없는 공통 schema를 제공한다", () => {
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "src", "openapi", "groupOpenApi.json"),
      "utf8",
    ),
  );
  assert.equal(spec.openapi, "3.0.3");
  const paths = Object.keys(spec.paths).sort();
  assert.deepEqual(paths, [
    "/group-invitations/received",
    "/group-invitations/{invitation_id}/cancel",
    "/group-invitations/{invitation_id}/respond",
    "/groups",
    "/groups/{group_id}",
    "/groups/{group_id}/calendar/range",
    "/groups/{group_id}/invitations",
    "/groups/{group_id}/leave",
    "/groups/{group_id}/members/{user_id}",
    "/groups/{group_id}/owner",
  ]);
  const serialized = JSON.stringify(spec.components.schemas);
  assert.doesNotMatch(serialized, /"email"/);
  assert.doesNotMatch(serialized, /"phone"/);
  assert.match(serialized, /owner_user_id/);
  assert.match(serialized, /\^#\[0-9A-F\]\{8\}\$/);
  assert.equal(
    spec.components.schemas.GroupDetail.required.includes("members_preview"),
    false,
  );
});

test("모든 그룹 도메인 오류의 HTTP status 매핑을 고정한다", () => {
  const expected_statuses = {
    INVALID_GROUP_NAME: 400,
    INVALID_GROUP_TIMEZONE: 400,
    INVALID_DATE_RANGE: 400,
    GROUP_CALENDAR_RANGE_TOO_LARGE: 400,
    INVALID_GROUP_INVITATION_ACTION: 400,
    INVALID_GROUP_MEMBER_ROLE: 400,
    GROUP_PERMISSION_DENIED: 403,
    GROUP_NOT_FOUND: 404,
    GROUP_MEMBER_NOT_FOUND: 404,
    GROUP_INVITATION_NOT_FOUND: 404,
    GROUP_MEMBER_ALREADY_EXISTS: 409,
    GROUP_INVITATION_ALREADY_PENDING: 409,
    GROUP_INVITATION_ALREADY_PROCESSED: 409,
    GROUP_INVITATION_EXPIRED: 409,
    GROUP_INVITEE_NOT_FRIEND: 409,
    GROUP_MEMBER_LIMIT_REACHED: 409,
    GROUP_OWNER_CANNOT_LEAVE: 409,
    GROUP_OWNER_CANNOT_BE_REMOVED: 409,
    INVALID_GROUP_OWNER_TRANSFER: 409,
  };
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(group_error_http_map).map(([code, value]) => [
        code,
        value.status,
      ]),
    ),
    expected_statuses,
  );
});

const migration_static_test =
  present_local_migration_files.length === 0 ? test.skip : test;

migration_static_test("migration은 preflight, 제약, postflight, 명시적 rollback 확인을 포함한다", () => {
  assertLocalMigrationSetComplete();
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "add_group_feature.sql"),
    "utf8",
  );
  const rollback = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "rollback_group_feature.sql"),
    "utf8",
  );
  assert.match(migration, /existing_objects IS NOT NULL/);
  assert.match(migration, /uq_group_members_active_owner/);
  assert.match(migration, /uq_group_invitations_pending/);
  assert.match(migration, /ck_group_invitations_response/);
  assert.match(migration, /information_schema\.columns/);
  assert.match(migration, /pg_indexes/);
  assert.match(rollback, /confirm_group_feature_drop/);
  assert.match(rollback, /RAISE EXCEPTION/);
  assert.doesNotMatch(rollback, /\\quit/);
  assert.ok(
    rollback.indexOf("DROP TABLE group_invitations") <
      rollback.indexOf("DROP TABLE group_members"),
  );
  assert.ok(
    rollback.indexOf("DROP TABLE group_members") <
      rollback.indexOf("DROP TABLE groups"),
  );
});

migration_static_test("Stage migration wrapper는 DB·백업·checksum 승인과 strict 감사를 강제한다", () => {
  assertLocalMigrationSetComplete();
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "add_group_feature.sql"),
    "utf8",
  );
  const preflight = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "migrations",
      "stage_group_feature_preflight.sql",
    ),
    "utf8",
  );
  const apply = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "migrations",
      "stage_apply_group_feature.sql",
    ),
    "utf8",
  );
  const postflight = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "migrations",
      "stage_group_feature_postflight.sql",
    ),
    "utf8",
  );
  const pgadmin = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "migrations",
      "pgadmin_stage_add_group_feature.sql",
    ),
    "utf8",
  );
  const migration_sha256 = crypto
    .createHash("sha256")
    .update(migration)
    .digest("hex");

  assert.match(preflight, /expected_database/);
  assert.match(preflight, /server_version_num/);
  assert.match(preflight, /pg_is_in_recovery/);
  assert.match(preflight, /v_visible_work_shifts_for_friend/);
  assert.match(preflight, /conflicting_index_names/);
  assert.match(apply, /confirm_stage_group_migration/);
  assert.match(apply, /backup_reference/);
  assert.match(apply, new RegExp(migration_sha256));
  assert.match(apply, /pg_try_advisory_lock/);
  assert.match(apply, /SET lock_timeout = '5s'/);
  assert.match(apply, /SET search_path = public, pg_catalog/);
  assert.match(apply, /\\ir stage_group_feature_preflight\.sql/);
  assert.match(apply, /\\ir add_group_feature\.sql/);
  assert.match(apply, /\\ir stage_group_feature_postflight\.sql/);
  assert.match(postflight, /전체 컬럼 수가 27개/);
  assert.match(postflight, /missing_or_invalid_constraints/);
  assert.match(postflight, /missing_or_invalid_indexes/);
  assert.match(postflight, /missing_comments/);
  assert.match(postflight, /expect_group_tables_empty/);
  assert.doesNotMatch(`${preflight}\n${apply}\n${postflight}`, /\\quit/);
  assert.doesNotMatch(pgadmin, /^\s*\\/m);
  assert.match(pgadmin, /^BEGIN;/m);
  assert.match(pgadmin, /^COMMIT;/m);
  assert.match(pgadmin, /REPLACE_WITH_ACTUAL_STAGE_DB_NAME/);
  assert.match(pgadmin, /APPLY_GROUP_FEATURE_TO_STAGE/);
  assert.match(pgadmin, /pg_try_advisory_xact_lock/);
  assert.match(pgadmin, /SET LOCAL search_path = public, pg_catalog/);
  assert.match(pgadmin, /CREATE TABLE public\.groups/);
  assert.match(pgadmin, /CREATE TABLE public\.group_members/);
  assert.match(pgadmin, /CREATE TABLE public\.group_invitations/);
  assert.match(pgadmin, /전체 컬럼 수가 27개/);
  assert.match(pgadmin, /cardinality\(constraint_names\) <> 20/);
  assert.match(pgadmin, /cardinality\(index_names\) <> 11/);
  assert.match(pgadmin, new RegExp(migration_sha256));
});
