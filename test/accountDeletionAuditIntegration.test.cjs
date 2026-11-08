const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const enabled = process.env.RUN_ACCOUNT_DELETION_INTEGRATION === "true";
const isolated = process.env.ACCOUNT_DELETION_INTEGRATION_ALLOW_SCHEMA_RESET === "true" &&
  process.env.DB_HOST === "127.0.0.1" && process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" && process.env.DB_USER === "group_debug";

if (!enabled) {
  test("탈퇴 감사 FK 회귀는 격리 PostgreSQL 명시 활성화 필요", { skip: true }, () => {});
} else if (!isolated) {
  test("공유 DB 초기화 거절", () => assert.fail("고정 격리 DB와 schema reset 동의 필요"));
} else {
  Object.assign(process.env, {
    NODE_ENV: "test", ACCOUNT_DELETION_ENABLED: "true", REDIS_URL: "",
    PROFILE_IMAGE_STORAGE_BUCKET: "audit-integration", PROFILE_IMAGE_STORAGE_REGION: "us-east-1",
    PROFILE_IMAGE_STORAGE_PREFIX: "test",
    JWT_SECRET: "audit-integration-access", JWT_REFRESH_SECRET: "audit-integration-refresh",
  });
  const { sequelize } = require("../dist/config/database");
  const { QueryTypes } = require("sequelize");
  const { User, AccountDeletionRequest } = require("../dist/models");
  const { requestAccountDeletion } = require("../dist/services/accountDeletionService");
  const { processAccountDeletionRequest } = require("../dist/workers/accountDeletionWorker");
  const { generateTokens } = require("../dist/services/authService");
  function readSql(file) {
    return fs.readFileSync(file, "utf8").split("\n")
      .filter((line) => !line.startsWith("\\")).join("\n");
  }
  test.before(async () => {
    await sequelize.authenticate();
    await sequelize.query(readSql("migrations/final_schema.sql"));
  });
  test.after(async () => { await sequelize.close(); });

  test("삭제 그룹·제거 멤버 감사자 탈퇴: 기존 오류 재현 → migration → worker 재개 및 동일 이메일 재가입", async () => {
    for (const target of ["groups", "group_members"]) {
      await sequelize.query(readSql("migrations/final_schema.sql"));
      const deleting_user = await User.create({ email: `${target}@example.test`, name: "감사자" });
      const survivor = await User.create({ email: `${target}-survivor@example.test`, name: "잔존 회원" });
      const [group] = await sequelize.query(
        `INSERT INTO groups (name, timezone, created_by_user_id, deleted_at, deleted_by_user_id)
         VALUES ('감사 이력', 'Asia/Seoul', :survivor_id,
           CASE WHEN :deleted THEN '2026-08-02T14:25:03Z'::timestamptz ELSE NULL END,
           CASE WHEN :deleted THEN :actor_id::uuid ELSE NULL END)
         RETURNING group_id, deleted_at`,
        { replacements: { survivor_id: survivor.user_id, actor_id: deleting_user.user_id, deleted: target === "groups" }, type: QueryTypes.SELECT },
      );
      const [member] = await sequelize.query(
        `INSERT INTO group_members (group_id, user_id, added_by_user_id, removed_at, removed_by_user_id)
         VALUES (:group_id, :survivor_id, :actor_id, '2026-08-02T14:25:03Z', :actor_id)
         RETURNING group_member_id, removed_at`,
        { replacements: { group_id: group.group_id, survivor_id: survivor.user_id, actor_id: deleting_user.user_id }, type: QueryTypes.SELECT },
      );
      const constraint = target === "groups" ? "ck_groups_deleted_pair" : "ck_group_members_removed_pair";
      const time_column = target === "groups" ? "deleted_at" : "removed_at";
      const actor_column = target === "groups" ? "deleted_by_user_id" : "removed_by_user_id";
      // 운영 장애 당시의 CHECK를 복원해 오류를 재현한다.
      await sequelize.query(`ALTER TABLE ${target} DROP CONSTRAINT ${constraint},
        ADD CONSTRAINT ${constraint} CHECK (
          (${time_column} IS NULL AND ${actor_column} IS NULL) OR
          (${time_column} IS NOT NULL AND ${actor_column} IS NOT NULL))`);
      const receipt = await requestAccountDeletion(deleting_user.user_id, Math.floor(Date.now() / 1000));
      // provider/이미지 처리 완료 checkpoint를 사용하여 외부 S3 호출을 생략한다.
      await AccountDeletionRequest.update({ images_purged_at: new Date() }, { where: { deletion_request_id: receipt.deletion_request_id } });
      await assert.rejects(processAccountDeletionRequest(receipt.deletion_request_id),
        (error) => error.parent?.code === "23514" && error.parent.constraint === constraint);
      const failed = await AccountDeletionRequest.findByPk(receipt.deletion_request_id);
      assert.equal(failed.status, "RETRY");
      assert.equal(failed.last_error_code, "ACCOUNT_DB_PURGE_FAILED");
      assert.equal(failed.db_purged_at, null);
      await deleting_user.reload();
      assert.equal(deleting_user.account_status, "DELETION_PENDING");
      await assert.rejects(generateTokens(deleting_user), /ACCOUNT_DELETION_IN_PROGRESS/);

      await sequelize.query(readSql("migrations/fix_account_deletion_audit_constraints.sql"));
      await sequelize.query(readSql("migrations/fix_account_deletion_audit_constraints.sql"));
      await processAccountDeletionRequest(receipt.deletion_request_id);
      await processAccountDeletionRequest(receipt.deletion_request_id);
      const completed = await AccountDeletionRequest.findByPk(receipt.deletion_request_id);
      assert.equal(completed.status, "COMPLETED");
      assert.ok(completed.db_purged_at);
      assert.equal(completed.user_id, null);
      assert.equal(await User.findByPk(deleting_user.user_id), null);
      assert.ok(await User.findByPk(survivor.user_id));
      const [retained_group] = await sequelize.query("SELECT * FROM groups WHERE group_id = :group_id",
        { replacements: group, type: QueryTypes.SELECT });
      assert.equal(retained_group.deleted_at?.getTime(), group.deleted_at?.getTime());
      assert.equal(retained_group.deleted_by_user_id, null);
      const [retained_member] = await sequelize.query("SELECT * FROM group_members WHERE group_member_id = :group_member_id",
        { replacements: member, type: QueryTypes.SELECT });
      assert.equal(retained_member.removed_at.getTime(), member.removed_at.getTime());
      assert.equal(retained_member.removed_by_user_id, null);
      assert.equal(retained_member.added_by_user_id, null);
      // 시각 없는 감사자 입력은 수정 후에도 거절한다.
      await assert.rejects(sequelize.query(`UPDATE groups SET deleted_at = NULL, deleted_by_user_id = :actor_id WHERE group_id = :group_id`,
        { replacements: { actor_id: survivor.user_id, group_id: group.group_id } }), (error) => error.parent?.code === "23514");
      await assert.rejects(sequelize.query(`UPDATE group_members SET removed_at = NULL, removed_by_user_id = :actor_id WHERE group_member_id = :group_member_id`,
        { replacements: { actor_id: survivor.user_id, group_member_id: member.group_member_id } }), (error) => error.parent?.code === "23514");
      const rejoined_user = await User.create({ email: deleting_user.email, name: "재가입" });
      await generateTokens(rejoined_user);
      assert.notEqual(rejoined_user.user_id, deleting_user.user_id);
    }
  });
}
