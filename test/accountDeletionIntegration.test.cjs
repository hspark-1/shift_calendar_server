const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const destructive_reset_is_explicitly_allowed =
  process.env.ACCOUNT_DELETION_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const is_isolated_debug_database =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

function readSqlForDatabaseDriver(relative_path) {
  return fs
    .readFileSync(path.join(__dirname, "..", relative_path), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

if (process.env.RUN_ACCOUNT_DELETION_INTEGRATION !== "true") {
  test("회원 탈퇴 PostgreSQL 16 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else if (!destructive_reset_is_explicitly_allowed || !is_isolated_debug_database) {
  test("회원 탈퇴 통합 테스트는 고정된 격리 DB에서만 public schema를 초기화한다", () => {
    assert.fail(
      "ACCOUNT_DELETION_INTEGRATION_ALLOW_SCHEMA_RESET=true와 127.0.0.1:55432/shift_calendar_group_debug/group_debug 연결이 모두 필요합니다.",
    );
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.ACCOUNT_DELETION_ENABLED = "true";
  process.env.JWT_SECRET = "account-deletion-integration-access";
  process.env.JWT_REFRESH_SECRET = "account-deletion-integration-refresh";
  delete process.env.REDIS_URL;

  const { QueryTypes } = require("sequelize");
  const {
    connectDatabase,
    disconnectDatabase,
    sequelize,
  } = require("../dist/config/database.js");
  const {
    AccountDeletionRequest,
    RefreshToken,
    User,
  } = require("../dist/models/index.js");
  const {
    requestAccountDeletion,
  } = require("../dist/services/accountDeletionService.js");
  const {
    processAccountDeletionRequest,
  } = require("../dist/workers/accountDeletionWorker.js");

  test.before(async () => {
    await connectDatabase();
    const schema = readSqlForDatabaseDriver("migrations/final_schema.sql");
    await sequelize.query(schema);
  });

  test.after(async () => {
    await disconnectDatabase();
  });

  test("접수 즉시 인증 자산을 차단하고 worker가 그룹 소유권 승계 후 전체 삭제한다", async () => {
    const deleting_user = await User.create({
      email: "delete-me@example.com",
      name: "삭제 대상",
      timezone: "Asia/Seoul",
    });
    const successor = await User.create({
      email: "successor@example.com",
      name: "승계자",
      timezone: "Asia/Seoul",
    });
    await RefreshToken.create({
      user_id: deleting_user.user_id,
      token_hash: "a".repeat(64),
      expires_at: new Date(Date.now() + 86_400_000),
    });

    const [{ group_id }] = await sequelize.query(
      `INSERT INTO groups (name, timezone, created_by_user_id)
       VALUES ('통합 그룹', 'Asia/Seoul', :owner_id)
       RETURNING group_id`,
      {
        replacements: { owner_id: deleting_user.user_id },
        type: QueryTypes.SELECT,
      },
    );
    await sequelize.query(
      `INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
       VALUES
         (:group_id, :owner_id, 'OWNER', :owner_id),
         (:group_id, :successor_id, 'ADMIN', :owner_id)`,
      {
        replacements: {
          group_id,
          owner_id: deleting_user.user_id,
          successor_id: successor.user_id,
        },
      },
    );

    const receipt = await requestAccountDeletion(
      deleting_user.user_id,
      Math.floor(Date.now() / 1000),
    );
    await deleting_user.reload();
    assert.equal(deleting_user.account_status, "DELETION_PENDING");
    const refresh_token = await RefreshToken.findOne({
      where: { user_id: deleting_user.user_id },
    });
    assert.ok(refresh_token.revoked_at instanceof Date);

    await processAccountDeletionRequest(receipt.deletion_request_id);

    assert.equal(await User.findByPk(deleting_user.user_id), null);
    const completed_request = await AccountDeletionRequest.findByPk(
      receipt.deletion_request_id,
    );
    assert.equal(completed_request.status, "COMPLETED");
    assert.equal(completed_request.user_id, null);
    const [owner] = await sequelize.query(
      `SELECT user_id FROM group_members
       WHERE group_id = :group_id AND role = 'OWNER' AND removed_at IS NULL`,
      { replacements: { group_id }, type: QueryTypes.SELECT },
    );
    assert.equal(owner.user_id, successor.user_id);
  });
}
