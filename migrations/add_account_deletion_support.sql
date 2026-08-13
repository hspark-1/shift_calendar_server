BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE users
  ADD COLUMN account_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN deletion_requested_at timestamptz;

ALTER TABLE users
  ADD CONSTRAINT ck_users_account_status
    CHECK (account_status IN ('ACTIVE', 'DELETION_PENDING')),
  ADD CONSTRAINT ck_users_deletion_pair
    CHECK (
      (account_status = 'ACTIVE' AND deletion_requested_at IS NULL)
      OR
      (account_status = 'DELETION_PENDING' AND deletion_requested_at IS NOT NULL)
    );

CREATE INDEX idx_users_account_status
ON users(account_status, deletion_requested_at);

CREATE TABLE account_deletion_requests (
  deletion_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  status text NOT NULL DEFAULT 'PENDING',
  cache_year_months date[] NOT NULL DEFAULT ARRAY[]::date[],
  requested_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  db_purged_at timestamptz,
  cache_purged_at timestamptz,
  completed_at timestamptz,
  last_error_code text,

  CONSTRAINT ck_account_deletion_requests_status CHECK (
    status IN ('PENDING', 'PROCESSING', 'RETRY', 'CACHE_PURGE_PENDING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT ck_account_deletion_requests_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_account_deletion_requests_claim_pair CHECK (
    (claimed_at IS NULL AND claim_token IS NULL)
    OR (claimed_at IS NOT NULL AND claim_token IS NOT NULL)
  ),
  CONSTRAINT ck_account_deletion_requests_completion CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND user_id IS NULL)
    OR (status <> 'COMPLETED' AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_account_deletion_requests_active_user
ON account_deletion_requests(user_id)
WHERE user_id IS NOT NULL AND completed_at IS NULL;

CREATE INDEX idx_account_deletion_requests_claimable
ON account_deletion_requests(available_at, requested_at)
WHERE status IN ('PENDING', 'PROCESSING', 'RETRY', 'CACHE_PURGE_PENDING');

CREATE TABLE account_deletion_provider_tasks (
  provider_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_request_id uuid NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_account_deletion_provider_tasks_request
    FOREIGN KEY (deletion_request_id)
    REFERENCES account_deletion_requests(deletion_request_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_account_deletion_provider_tasks_request_provider
    UNIQUE (deletion_request_id, provider),
  CONSTRAINT ck_account_deletion_provider_tasks_provider
    CHECK (provider IN ('APPLE', 'KAKAO')),
  CONSTRAINT ck_account_deletion_provider_tasks_status CHECK (
    status IN ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT ck_account_deletion_provider_tasks_attempt_count
    CHECK (attempt_count >= 0),
  CONSTRAINT ck_account_deletion_provider_tasks_completion CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (status <> 'COMPLETED' AND completed_at IS NULL)
  )
);

-- 사용자 소유 데이터는 CASCADE, 단순 감사자는 nullable SET NULL로 통일한다.
ALTER TABLE friend_requests
  DROP CONSTRAINT fk_friend_requests_requester,
  DROP CONSTRAINT fk_friend_requests_addressee,
  ADD CONSTRAINT fk_friend_requests_requester
    FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_friend_requests_addressee
    FOREIGN KEY (addressee_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE friendships
  DROP CONSTRAINT fk_friendships_a,
  DROP CONSTRAINT fk_friendships_b,
  ADD CONSTRAINT fk_friendships_a
    FOREIGN KEY (user_id_a) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_friendships_b
    FOREIGN KEY (user_id_b) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE friend_level_settings
  DROP CONSTRAINT fk_fls_owner,
  DROP CONSTRAINT fk_fls_friend,
  ADD CONSTRAINT fk_fls_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_fls_friend
    FOREIGN KEY (friend_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE events
  ALTER COLUMN created_by_user_id DROP NOT NULL,
  DROP CONSTRAINT fk_events_owner,
  DROP CONSTRAINT fk_events_created_by,
  DROP CONSTRAINT fk_events_deleted_by,
  ADD CONSTRAINT fk_events_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_events_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_events_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE work_shifts
  ALTER COLUMN created_by_user_id DROP NOT NULL,
  DROP CONSTRAINT fk_work_shifts_owner,
  DROP CONSTRAINT fk_work_shifts_created_by,
  DROP CONSTRAINT fk_work_shifts_deleted_by,
  ADD CONSTRAINT fk_work_shifts_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_work_shifts_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_work_shifts_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE shift_templates
  DROP CONSTRAINT fk_shift_templates_owner,
  ADD CONSTRAINT fk_shift_templates_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE shift_template_versions
  ALTER COLUMN created_by_user_id DROP NOT NULL,
  DROP CONSTRAINT fk_shift_versions_template,
  DROP CONSTRAINT fk_shift_versions_creator,
  ADD CONSTRAINT fk_shift_versions_template
    FOREIGN KEY (template_id) REFERENCES shift_templates(template_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_shift_versions_creator
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE shift_types
  DROP CONSTRAINT fk_shift_types_template,
  ADD CONSTRAINT fk_shift_types_template
    FOREIGN KEY (template_id) REFERENCES shift_templates(template_id) ON DELETE CASCADE;

ALTER TABLE shift_type_schedules
  DROP CONSTRAINT fk_shift_schedules_type,
  DROP CONSTRAINT fk_shift_schedules_version,
  ADD CONSTRAINT fk_shift_schedules_type
    FOREIGN KEY (shift_type_id) REFERENCES shift_types(shift_type_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_shift_schedules_version
    FOREIGN KEY (template_version_id) REFERENCES shift_template_versions(template_version_id) ON DELETE CASCADE;

ALTER TABLE work_shift_month_states
  DROP CONSTRAINT fk_work_shift_month_states_owner,
  ADD CONSTRAINT fk_work_shift_month_states_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE work_shift_cache_outbox
  DROP CONSTRAINT fk_work_shift_cache_outbox_owner,
  ADD CONSTRAINT fk_work_shift_cache_outbox_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE groups
  ALTER COLUMN created_by_user_id DROP NOT NULL,
  DROP CONSTRAINT fk_groups_created_by,
  DROP CONSTRAINT fk_groups_deleted_by,
  ADD CONSTRAINT fk_groups_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_groups_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE group_members
  ALTER COLUMN added_by_user_id DROP NOT NULL,
  DROP CONSTRAINT fk_group_members_user,
  DROP CONSTRAINT fk_group_members_added_by,
  DROP CONSTRAINT fk_group_members_removed_by,
  ADD CONSTRAINT fk_group_members_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_group_members_added_by
    FOREIGN KEY (added_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_group_members_removed_by
    FOREIGN KEY (removed_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE group_invitations
  DROP CONSTRAINT fk_group_invitations_inviter,
  DROP CONSTRAINT fk_group_invitations_invitee,
  ADD CONSTRAINT fk_group_invitations_inviter
    FOREIGN KEY (inviter_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_group_invitations_invitee
    FOREIGN KEY (invitee_user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE push_deliveries
  DROP CONSTRAINT fk_push_deliveries_device,
  ADD CONSTRAINT fk_push_deliveries_device
    FOREIGN KEY (device_id) REFERENCES user_devices(device_id) ON DELETE CASCADE;

COMMENT ON COLUMN users.account_status IS 'ACTIVE 또는 DELETION_PENDING. 탈퇴 접수 즉시 일반 인증을 차단한다.';
COMMENT ON COLUMN users.deletion_requested_at IS '회원 탈퇴가 접수된 시각. ACTIVE이면 null';
COMMENT ON TABLE account_deletion_requests IS '외부 revoke, DB purge, Redis purge를 재시도하는 회원 탈퇴 원본 작업';
COMMENT ON TABLE account_deletion_provider_tasks IS '회원 탈퇴 요청의 Apple revoke/Kakao unlink 멱등 진행 상태';

COMMIT;
