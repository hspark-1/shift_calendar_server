-- 기존 회원 탈퇴 FK(ON DELETE SET NULL)와 감사 CHECK를 일치시킨다.
-- 대상 DB/백업을 확인하고 탈퇴 worker를 중지한 뒤 실행한다. 사용자 데이터는 변경하지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE groups
  DROP CONSTRAINT ck_groups_deleted_pair,
  ADD CONSTRAINT ck_groups_deleted_pair
    CHECK (deleted_at IS NOT NULL OR deleted_by_user_id IS NULL);

ALTER TABLE group_members
  DROP CONSTRAINT ck_group_members_removed_pair,
  ADD CONSTRAINT ck_group_members_removed_pair
    CHECK (removed_at IS NOT NULL OR removed_by_user_id IS NULL);

COMMENT ON COLUMN groups.deleted_by_user_id IS
  '그룹 soft delete 실행자. 계정 탈퇴 시 NULL이며 deleted_at은 보존';
COMMENT ON COLUMN group_members.removed_by_user_id IS
  '멤버십 종료 실행자. 계정 탈퇴 시 NULL이며 removed_at은 보존';
COMMIT;
