\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset account_deletion_rollback_

\if :account_deletion_rollback_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

\if :{?confirm_account_deletion_disabled}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'confirm_account_deletion_disabled 변수가 필요합니다.'; END $guard$;
\endif

\if :confirm_account_deletion_disabled
\else
  DO $guard$ BEGIN RAISE EXCEPTION '탈퇴 API와 worker 기능 플래그 비활성 확인이 필요합니다.'; END $guard$;
\endif

DO $zero_row_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE account_status <> 'ACTIVE')
     OR EXISTS (SELECT 1 FROM public.account_deletion_requests)
     OR EXISTS (SELECT 1 FROM public.account_deletion_provider_tasks) THEN
    RAISE EXCEPTION
      '회원 탈퇴 rollback 중단: 진행/이력 데이터가 존재합니다. 기능 플래그 비활성을 유지하세요.';
  END IF;
END;
$zero_row_guard$;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

DROP TABLE account_deletion_provider_tasks;
DROP TABLE account_deletion_requests;

ALTER TABLE friend_requests
  DROP CONSTRAINT fk_friend_requests_requester,
  DROP CONSTRAINT fk_friend_requests_addressee,
  ADD CONSTRAINT fk_friend_requests_requester FOREIGN KEY (requester_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_friend_requests_addressee FOREIGN KEY (addressee_user_id) REFERENCES users(user_id);
ALTER TABLE friendships
  DROP CONSTRAINT fk_friendships_a, DROP CONSTRAINT fk_friendships_b,
  ADD CONSTRAINT fk_friendships_a FOREIGN KEY (user_id_a) REFERENCES users(user_id),
  ADD CONSTRAINT fk_friendships_b FOREIGN KEY (user_id_b) REFERENCES users(user_id);
ALTER TABLE friend_level_settings
  DROP CONSTRAINT fk_fls_owner, DROP CONSTRAINT fk_fls_friend,
  ADD CONSTRAINT fk_fls_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_fls_friend FOREIGN KEY (friend_user_id) REFERENCES users(user_id);
ALTER TABLE events
  DROP CONSTRAINT fk_events_owner, DROP CONSTRAINT fk_events_created_by, DROP CONSTRAINT fk_events_deleted_by,
  ADD CONSTRAINT fk_events_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_events_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_events_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id),
  ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE work_shifts
  DROP CONSTRAINT fk_work_shifts_owner, DROP CONSTRAINT fk_work_shifts_created_by, DROP CONSTRAINT fk_work_shifts_deleted_by,
  ADD CONSTRAINT fk_work_shifts_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_work_shifts_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_work_shifts_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id),
  ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE shift_templates
  DROP CONSTRAINT fk_shift_templates_owner,
  ADD CONSTRAINT fk_shift_templates_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id);
ALTER TABLE shift_template_versions
  DROP CONSTRAINT fk_shift_versions_template, DROP CONSTRAINT fk_shift_versions_creator,
  ADD CONSTRAINT fk_shift_versions_template FOREIGN KEY (template_id) REFERENCES shift_templates(template_id),
  ADD CONSTRAINT fk_shift_versions_creator FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
  ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE shift_types
  DROP CONSTRAINT fk_shift_types_template,
  ADD CONSTRAINT fk_shift_types_template FOREIGN KEY (template_id) REFERENCES shift_templates(template_id);
ALTER TABLE shift_type_schedules
  DROP CONSTRAINT fk_shift_schedules_type, DROP CONSTRAINT fk_shift_schedules_version,
  ADD CONSTRAINT fk_shift_schedules_type FOREIGN KEY (shift_type_id) REFERENCES shift_types(shift_type_id),
  ADD CONSTRAINT fk_shift_schedules_version FOREIGN KEY (template_version_id) REFERENCES shift_template_versions(template_version_id);
ALTER TABLE work_shift_month_states
  DROP CONSTRAINT fk_work_shift_month_states_owner,
  ADD CONSTRAINT fk_work_shift_month_states_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id);
ALTER TABLE work_shift_cache_outbox
  DROP CONSTRAINT fk_work_shift_cache_outbox_owner,
  ADD CONSTRAINT fk_work_shift_cache_outbox_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id);
ALTER TABLE groups
  DROP CONSTRAINT fk_groups_created_by, DROP CONSTRAINT fk_groups_deleted_by,
  ADD CONSTRAINT fk_groups_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_groups_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id),
  ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE group_members
  DROP CONSTRAINT fk_group_members_user, DROP CONSTRAINT fk_group_members_added_by, DROP CONSTRAINT fk_group_members_removed_by,
  ADD CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_group_members_added_by FOREIGN KEY (added_by_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_group_members_removed_by FOREIGN KEY (removed_by_user_id) REFERENCES users(user_id),
  ALTER COLUMN added_by_user_id SET NOT NULL;
ALTER TABLE group_invitations
  DROP CONSTRAINT fk_group_invitations_inviter, DROP CONSTRAINT fk_group_invitations_invitee,
  ADD CONSTRAINT fk_group_invitations_inviter FOREIGN KEY (inviter_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_group_invitations_invitee FOREIGN KEY (invitee_user_id) REFERENCES users(user_id);
ALTER TABLE push_deliveries
  DROP CONSTRAINT fk_push_deliveries_device,
  ADD CONSTRAINT fk_push_deliveries_device FOREIGN KEY (device_id) REFERENCES user_devices(device_id);

DROP INDEX idx_users_account_status;
ALTER TABLE users
  DROP CONSTRAINT ck_users_deletion_pair,
  DROP CONSTRAINT ck_users_account_status,
  DROP COLUMN deletion_requested_at,
  DROP COLUMN account_status;

COMMIT;

\echo '빈 회원 탈퇴 schema rollback 완료'
