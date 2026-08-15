\set ON_ERROR_STOP on

/* =========================================================
FINAL SCHEMA (PostgreSQL) - Single-calendar-per-user

Source: AGENTS.md

주의:
- 이 파일은 로컬/초기화용 전체 DDL입니다.
- DROP SCHEMA IF EXISTS public CASCADE가 포함되어 있어 기존 public 스키마 데이터가 모두 삭제됩니다.

요구사항 반영 요약:
- 사용자 1명 = 캘린더 1개 (calendars 테이블 제거)
- 공유 = "내 캘린더를 친구에게 열람 허용" (calendar_shares 제거)
- 친구별 설정 = friend_level_settings에서 일괄 관리
  - can_view (내 캘린더 열람 허용/차단)
  - friend_level (레벨 비교로 일정 노출)
- 노출 규칙:
  - (can_view = true) AND (friend_level >= visibility_level)
  - work_shifts.visibility_level = 0 고정
- UUID 사용: pgcrypto + gen_random_uuid()
- 시간: timestamptz (UTC 저장 권장)
- Soft delete: deleted_at
========================================================= */

-- =========================================================
-- 0) PUBLIC SCHEMA 삭제 및 재생성
-- 경고: 기존 모든 데이터가 삭제됩니다.
-- =========================================================
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
GRANT ALL ON SCHEMA public TO public;

-- =========================================================
-- 1) Extensions
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 2) USERS
-- =========================================================
CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  profile_image_url text,
  timezone text,
  kakao_id text,
  apple_id text,
  google_id text,
  naver_id text,
  phone text,
  password text,
  account_status text NOT NULL DEFAULT 'ACTIVE',
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT ck_users_phone_format CHECK (
    phone IS NULL OR phone ~ '^[0-9]{3}-[0-9]{3,4}-[0-9]{4}$'
  ),
  CONSTRAINT ck_users_account_status CHECK (
    account_status IN ('ACTIVE', 'DELETION_PENDING')
  ),
  CONSTRAINT ck_users_deletion_pair CHECK (
    (account_status = 'ACTIVE' AND deletion_requested_at IS NULL)
    OR (account_status = 'DELETION_PENDING' AND deletion_requested_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_users_kakao_id ON users(kakao_id) WHERE kakao_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_apple_id ON users(apple_id) WHERE apple_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_naver_id ON users(naver_id) WHERE naver_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_account_status ON users(account_status, deletion_requested_at);

COMMENT ON TABLE users IS '앱 사용자. 사용자 1명당 캘린더 1개(=모든 일정/근무 owner_user_id=user_id)';
COMMENT ON COLUMN users.user_id IS '사용자 PK(UUID)';
COMMENT ON COLUMN users.email IS '로그인/식별용 이메일(유니크)';
COMMENT ON COLUMN users.timezone IS '사용자 선호 타임존(렌더링용)';
COMMENT ON COLUMN users.kakao_id IS '카카오 OAuth 사용자 ID';
COMMENT ON COLUMN users.apple_id IS '애플 OAuth 사용자 sub';
COMMENT ON COLUMN users.google_id IS 'Google OIDC subject(sub). 검증된 ID Token에서만 저장';
COMMENT ON COLUMN users.naver_id IS '네이버 OAuth 사용자 ID';
COMMENT ON COLUMN users.phone IS '전화번호. 000-000-0000 또는 000-0000-0000 형식으로 저장(친구 검색용)';
COMMENT ON COLUMN users.password IS '패스워드 인증용 bcrypt 해시 (OAuth 사용자는 null)';
COMMENT ON COLUMN users.account_status IS 'ACTIVE 또는 DELETION_PENDING. 탈퇴 접수 즉시 일반 인증을 차단한다.';
COMMENT ON COLUMN users.deletion_requested_at IS '회원 탈퇴가 접수된 시각. ACTIVE이면 null';

-- =========================================================
-- 3) FRIEND REQUESTS
-- =========================================================
CREATE TABLE friend_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL,
  addressee_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,

  CONSTRAINT fk_friend_requests_requester FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_friend_requests_addressee FOREIGN KEY (addressee_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_friend_requests_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED')),
  CONSTRAINT ck_friend_requests_not_self CHECK (requester_user_id <> addressee_user_id)
);

CREATE UNIQUE INDEX uq_friend_requests_pending_pair
ON friend_requests (requester_user_id, addressee_user_id)
WHERE status = 'PENDING';

CREATE INDEX idx_friend_requests_addressee_status
ON friend_requests (addressee_user_id, status, created_at DESC);

CREATE INDEX idx_friend_requests_requester_status
ON friend_requests (requester_user_id, status, created_at DESC);

COMMENT ON TABLE friend_requests IS '친구 요청/수락. ACCEPTED 시 friendships + friend_level_settings(양방향) 자동 생성';

-- =========================================================
-- 4) FRIENDSHIPS
-- =========================================================
CREATE TABLE friendships (
  user_id_a uuid NOT NULL,
  user_id_b uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_friendships PRIMARY KEY (user_id_a, user_id_b),
  CONSTRAINT fk_friendships_a FOREIGN KEY (user_id_a) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_b FOREIGN KEY (user_id_b) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_friendships_order CHECK (user_id_a < user_id_b)
);

CREATE INDEX idx_friendships_user_a ON friendships(user_id_a);
CREATE INDEX idx_friendships_user_b ON friendships(user_id_b);

COMMENT ON TABLE friendships IS '수락된 친구 관계(대칭). user_id_a < user_id_b로 1건만 저장';

-- =========================================================
-- 5) FRIEND LEVEL SETTINGS
-- =========================================================
CREATE TABLE friend_level_settings (
  owner_user_id uuid NOT NULL,
  friend_user_id uuid NOT NULL,

  can_view boolean NOT NULL DEFAULT true,
  friend_level smallint NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_friend_level_settings PRIMARY KEY (owner_user_id, friend_user_id),
  CONSTRAINT fk_fls_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_fls_friend FOREIGN KEY (friend_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_fls_level CHECK (friend_level >= 0),
  CONSTRAINT ck_fls_not_self CHECK (owner_user_id <> friend_user_id)
);

CREATE INDEX idx_fls_owner ON friend_level_settings(owner_user_id);

CREATE INDEX idx_fls_owner_can_view_level
ON friend_level_settings(owner_user_id, can_view, friend_level DESC);

COMMENT ON TABLE friend_level_settings IS '친구별 열람 설정(ACL + 레벨). 노출 조건: can_view=true AND friend_level>=visibility_level';

-- =========================================================
-- 6) SHIFT TEMPLATES / VERSIONS / TYPES / SCHEDULES
-- =========================================================
CREATE TABLE shift_templates (
  template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,

  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT fk_shift_templates_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT uq_shift_templates_name UNIQUE (owner_user_id, name)
);

CREATE INDEX idx_shift_templates_owner
ON shift_templates(owner_user_id)
WHERE deleted_at IS NULL;

COMMENT ON TABLE shift_templates IS '근무 템플릿(사용자 단위). 예: 기본 3교대';

CREATE TABLE shift_template_versions (
  template_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,

  version_no int NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_shift_versions_template FOREIGN KEY (template_id) REFERENCES shift_templates(template_id) ON DELETE CASCADE,
  CONSTRAINT fk_shift_versions_creator FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT uq_shift_versions_no UNIQUE (template_id, version_no),
  CONSTRAINT uq_shift_versions_effective UNIQUE (template_id, effective_from),
  CONSTRAINT ck_shift_versions_no CHECK (version_no > 0)
);

CREATE INDEX idx_shift_versions_template_effective
ON shift_template_versions(template_id, effective_from DESC);

COMMENT ON TABLE shift_template_versions IS '템플릿 시간표 버전 스냅샷. 설정 변경은 UPDATE가 아니라 버전 INSERT';

CREATE TABLE shift_types (
  shift_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,

  code text NOT NULL,
  name text NOT NULL,
  color text,
  base_color text,
  color_intensity smallint NOT NULL DEFAULT 100,
  sort_order smallint,

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT fk_shift_types_template FOREIGN KEY (template_id) REFERENCES shift_templates(template_id) ON DELETE CASCADE,
  CONSTRAINT ck_shift_types_color_intensity CHECK (color_intensity BETWEEN 0 AND 100),
  CONSTRAINT ck_shift_types_base_color_format CHECK (
    base_color IS NULL
    OR base_color ~ '^#[0-9A-F]{8}$'
  )
);

CREATE INDEX idx_shift_types_template
ON shift_types(template_id)
WHERE deleted_at IS NULL;

COMMENT ON TABLE shift_types IS '근무 타입(사용자 정의). 최종 color와 기준 base_color/농도 color_intensity 지원. (template_id, code) 중복 허용';
COMMENT ON COLUMN shift_types.base_color IS '색상 농도 적용 전 기준 색상. #AARRGGBB';
COMMENT ON COLUMN shift_types.color_intensity IS '기준 색상 농도 정수 퍼센트. 0~100';

CREATE TABLE shift_type_schedules (
  schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_type_id uuid NOT NULL,
  template_version_id uuid NOT NULL,

  start_time time,
  end_time time,
  crosses_midnight boolean NOT NULL DEFAULT false,
  duration_minutes int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_shift_schedules_type FOREIGN KEY (shift_type_id) REFERENCES shift_types(shift_type_id) ON DELETE CASCADE,
  CONSTRAINT fk_shift_schedules_version FOREIGN KEY (template_version_id) REFERENCES shift_template_versions(template_version_id) ON DELETE CASCADE,
  CONSTRAINT uq_shift_schedules UNIQUE (template_version_id, shift_type_id),
  CONSTRAINT ck_shift_schedule_time_required CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR
    (start_time IS NOT NULL AND end_time IS NOT NULL)
  ),
  CONSTRAINT ck_shift_schedule_duration CHECK (duration_minutes >= 0)
);

CREATE INDEX idx_shift_schedules_version
ON shift_type_schedules(template_version_id);

CREATE INDEX idx_shift_schedules_type
ON shift_type_schedules(shift_type_id);

COMMENT ON TABLE shift_type_schedules IS '버전별 근무 시간표 스냅샷(시작/종료/자정넘김/시간(분))';

-- =========================================================
-- 7) EVENTS
-- =========================================================
CREATE TABLE events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id uuid NOT NULL,
  created_by_user_id uuid,

  title text NOT NULL,
  memo text,
  place text,

  all_day boolean NOT NULL DEFAULT false,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,

  visibility_level smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  deleted_at timestamptz,
  deleted_by_user_id uuid,

  CONSTRAINT fk_events_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_events_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_events_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_events_time CHECK (start_at < end_at),
  CONSTRAINT ck_events_visibility CHECK (visibility_level >= 0)
);

CREATE INDEX idx_events_owner_start_not_deleted
ON events(owner_user_id, start_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_events_owner_visibility_not_deleted
ON events(owner_user_id, visibility_level, start_at)
WHERE deleted_at IS NULL;

COMMENT ON TABLE events IS '개인 일정. 노출 조건: (친구 설정 can_view=true) AND (friend_level >= visibility_level)';

-- =========================================================
-- 8) WORK SHIFTS
-- =========================================================
CREATE TABLE work_shifts (
  work_shift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id uuid NOT NULL,
  work_date date NOT NULL,

  schedule_id uuid NOT NULL,
  note text,

  visibility_level smallint NOT NULL DEFAULT 0,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  deleted_at timestamptz,
  deleted_by_user_id uuid,

  CONSTRAINT fk_work_shifts_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_work_shifts_schedule FOREIGN KEY (schedule_id) REFERENCES shift_type_schedules(schedule_id),
  CONSTRAINT fk_work_shifts_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_work_shifts_deleted_by FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT uq_work_shifts_one_per_day UNIQUE (owner_user_id, work_date),
  CONSTRAINT ck_work_shifts_visibility_fixed CHECK (visibility_level = 0)
);

CREATE INDEX idx_work_shifts_owner_date_not_deleted
ON work_shifts(owner_user_id, work_date)
WHERE deleted_at IS NULL;

COMMENT ON TABLE work_shifts IS '근무표(날짜 기반). visibility_level=0 고정 → can_view=true인 친구는 모두 열람 가능';

-- =========================================================
-- 9) WORK SHIFT MONTH CACHE STATE / OUTBOX
-- =========================================================
CREATE TABLE work_shift_month_states (
  owner_user_id uuid NOT NULL,
  year_month date NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  last_modified_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_work_shift_month_states PRIMARY KEY (owner_user_id, year_month),
  CONSTRAINT fk_work_shift_month_states_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_work_shift_month_states_first_day CHECK (year_month = date_trunc('month', year_month)::date),
  CONSTRAINT ck_work_shift_month_states_revision CHECK (revision > 0)
);

CREATE TABLE work_shift_cache_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'WORK_SHIFT_MONTH_CHANGED',
  owner_user_id uuid NOT NULL,
  year_month date NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  last_error_code text,

  CONSTRAINT fk_work_shift_cache_outbox_owner FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_work_shift_cache_outbox_type CHECK (event_type = 'WORK_SHIFT_MONTH_CHANGED'),
  CONSTRAINT ck_work_shift_cache_outbox_first_day CHECK (year_month = date_trunc('month', year_month)::date),
  CONSTRAINT ck_work_shift_cache_outbox_revision CHECK (revision > 0),
  CONSTRAINT ck_work_shift_cache_outbox_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_work_shift_cache_outbox_claim_pair CHECK (
    (claimed_at IS NULL AND claim_token IS NULL)
    OR (claimed_at IS NOT NULL AND claim_token IS NOT NULL)
  )
);

CREATE INDEX idx_work_shift_cache_outbox_pending
ON work_shift_cache_outbox(next_attempt_at, created_at)
WHERE processed_at IS NULL;

CREATE INDEX idx_work_shift_cache_outbox_claimed
ON work_shift_cache_outbox(claimed_at)
WHERE processed_at IS NULL AND claimed_at IS NOT NULL;

COMMENT ON TABLE work_shift_month_states IS '사용자-월 근무표 변경 revision. 캐시 ETag와 무효화 fence의 PostgreSQL 원본';
COMMENT ON TABLE work_shift_cache_outbox IS '근무표 월 캐시 무효화 이벤트. DB 변경과 같은 트랜잭션에서 기록하고 worker가 Redis에 반영';

-- =========================================================
-- 10) REFRESH TOKENS
-- =========================================================
CREATE TABLE refresh_tokens (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  device_info text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_refresh_tokens_user
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_refresh_tokens_user
ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX idx_refresh_tokens_hash
ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

CREATE INDEX idx_refresh_tokens_expires
ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE refresh_tokens IS 'JWT Refresh Token 저장. 로그아웃 시 revoked_at 설정으로 무효화';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'refresh_token의 SHA-256 해시값';
COMMENT ON COLUMN refresh_tokens.device_info IS '토큰 발급 디바이스 정보 (User-Agent 등)';
COMMENT ON COLUMN refresh_tokens.revoked_at IS '토큰 무효화 시점. null이면 유효한 토큰';

-- =========================================================
-- 10-A) APPLE OAUTH LOGIN CHALLENGES / AUTHORIZATIONS
-- =========================================================
CREATE TABLE oauth_login_challenges (
  challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  platform text NOT NULL,
  state_hash char(64) NOT NULL,
  nonce_hash char(64) NOT NULL,
  client_id text NOT NULL,
  redirect_uri text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_oauth_challenge_provider CHECK (provider = 'APPLE'),
  CONSTRAINT ck_oauth_challenge_platform CHECK (platform IN ('ios', 'android')),
  CONSTRAINT ck_oauth_challenge_state_hash CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_oauth_challenge_nonce_hash CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_oauth_challenge_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_oauth_challenge_redirect CHECK (
    (platform = 'ios' AND redirect_uri IS NULL)
    OR (platform = 'android' AND redirect_uri IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_oauth_login_challenges_state
ON oauth_login_challenges(state_hash);

CREATE INDEX idx_oauth_login_challenges_cleanup
ON oauth_login_challenges(expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE oauth_authorizations (
  authorization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  client_id text NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_iv bytea NOT NULL,
  refresh_token_auth_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,

  CONSTRAINT fk_oauth_authorizations_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_oauth_authorizations_provider CHECK (provider = 'APPLE'),
  CONSTRAINT uq_oauth_authorizations_subject_client
    UNIQUE (provider, provider_subject, client_id)
);

CREATE INDEX idx_oauth_authorizations_user_active
ON oauth_authorizations(user_id, provider)
WHERE revoked_at IS NULL;

COMMENT ON TABLE oauth_login_challenges IS
  '소셜 로그인 전 일회성 state/nonce hash. 원문 credential은 저장하지 않는다.';
COMMENT ON TABLE oauth_authorizations IS
  '외부 OAuth 연결과 계정 삭제용 refresh token 암호문. 앱 JWT refresh_tokens와 분리한다.';

-- =========================================================
-- 10-B) ACCOUNT DELETION REQUESTS / PROVIDER TASKS
-- =========================================================
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
  CONSTRAINT ck_account_deletion_provider_tasks_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_account_deletion_provider_tasks_completion CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (status <> 'COMPLETED' AND completed_at IS NULL)
  )
);

COMMENT ON TABLE account_deletion_requests IS
  '외부 revoke, DB purge, Redis purge를 재시도하는 회원 탈퇴 원본 작업';
COMMENT ON TABLE account_deletion_provider_tasks IS
  '회원 탈퇴 요청의 Apple revoke/Kakao unlink 멱등 진행 상태';

-- =========================================================
-- 11) TRIGGER
-- =========================================================
CREATE OR REPLACE FUNCTION fn_on_friend_request_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND OLD.status = 'PENDING'
    AND NEW.status IN ('ACCEPTED', 'REJECTED', 'CANCELED')
    AND NEW.responded_at IS NULL THEN
    NEW.responded_at := now();
  END IF;

  IF NEW.status = 'ACCEPTED' AND OLD.status = 'PENDING' THEN
    v_user_a := LEAST(NEW.requester_user_id, NEW.addressee_user_id);
    v_user_b := GREATEST(NEW.requester_user_id, NEW.addressee_user_id);

    INSERT INTO friendships (user_id_a, user_id_b)
    VALUES (v_user_a, v_user_b)
    ON CONFLICT DO NOTHING;

    INSERT INTO friend_level_settings (owner_user_id, friend_user_id, can_view, friend_level)
    VALUES
      (NEW.requester_user_id, NEW.addressee_user_id, true, 0),
      (NEW.addressee_user_id, NEW.requester_user_id, true, 0)
    ON CONFLICT (owner_user_id, friend_user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

CREATE TRIGGER trg_friend_request_status_change
BEFORE UPDATE ON friend_requests
FOR EACH ROW
EXECUTE FUNCTION fn_on_friend_request_status_change();

-- =========================================================
-- 12) VIEWS
-- =========================================================
CREATE OR REPLACE VIEW v_visible_events_for_friend AS
SELECT
  e.*,
  fls.friend_user_id AS viewer_user_id
FROM events e
JOIN friend_level_settings fls
  ON fls.owner_user_id = e.owner_user_id
 AND fls.can_view = true
WHERE e.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM friendships f
    WHERE f.user_id_a = LEAST(e.owner_user_id, fls.friend_user_id)
      AND f.user_id_b = GREATEST(e.owner_user_id, fls.friend_user_id)
  )
  AND fls.friend_level >= e.visibility_level;

CREATE OR REPLACE VIEW v_visible_work_shifts_for_friend AS
SELECT
  ws.*,
  fls.friend_user_id AS viewer_user_id
FROM work_shifts ws
JOIN friend_level_settings fls
  ON fls.owner_user_id = ws.owner_user_id
 AND fls.can_view = true
WHERE ws.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM friendships f
    WHERE f.user_id_a = LEAST(ws.owner_user_id, fls.friend_user_id)
      AND f.user_id_b = GREATEST(ws.owner_user_id, fls.friend_user_id)
  )
  AND fls.friend_level >= ws.visibility_level;

-- =========================================================
-- 13) NOTIFICATIONS
-- =========================================================
CREATE TABLE notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,

  notification_type text NOT NULL,
  title text NOT NULL,
  body text,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,

  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user_unread
ON notifications(user_id, created_at DESC)
WHERE is_read = false;

CREATE INDEX idx_notifications_user_created
ON notifications(user_id, created_at DESC);

CREATE INDEX idx_notifications_type
ON notifications(notification_type, created_at DESC);

COMMENT ON TABLE notifications IS '앱 알림. 다양한 알림 지원 (확장 가능). 프론트에서 동적 버튼 표시 가능';
COMMENT ON COLUMN notifications.user_id IS '알림 수신자 (FK → users)';
COMMENT ON COLUMN notifications.notification_type IS '알림 타입 (자유롭게 확장 가능: FRIEND_REQUEST, FRIEND_ACCEPTED, SYSTEM 등)';
COMMENT ON COLUMN notifications.payload IS '알림 관련 추가 데이터 (JSON). 예: related_user_id, request_id, user_name 등';
COMMENT ON COLUMN notifications.actions IS '프론트엔드 버튼/액션 정의 (JSON 배열). 예: [{"type": "accept", "label": "수락"}]';
COMMENT ON COLUMN notifications.is_read IS '읽음 여부 (알림 목록 조회 시 자동 업데이트)';
COMMENT ON COLUMN notifications.read_at IS '읽은 시간';

-- =========================================================
-- 14) GROUPS / GROUP MEMBERS / GROUP INVITATIONS
-- 그룹은 별도 캘린더를 소유하지 않고 기존 개인 캘린더 공개 규칙을 aggregate한다.
-- =========================================================
CREATE TABLE groups (
  group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid,

  CONSTRAINT fk_groups_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_groups_deleted_by
    FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_groups_name
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  CONSTRAINT ck_groups_deleted_pair
    CHECK (
      (deleted_at IS NULL AND deleted_by_user_id IS NULL)
      OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL)
    )
);

CREATE INDEX idx_groups_created_by_active
ON groups(created_by_user_id, created_at DESC)
WHERE deleted_at IS NULL;

COMMENT ON TABLE groups IS '그룹 방. 별도 캘린더를 소유하지 않고 활성 구성원의 개인 캘린더를 aggregate 조회한다.';
COMMENT ON COLUMN groups.group_id IS '그룹 PK(UUID)';
COMMENT ON COLUMN groups.name IS 'trim 기준 1~50자의 그룹 표시 이름';
COMMENT ON COLUMN groups.timezone IS '그룹 캘린더 날짜 범위 해석에 사용하는 검증된 IANA timezone';
COMMENT ON COLUMN groups.created_by_user_id IS '그룹 생성자. 현재 OWNER와 다를 수 있는 감사 값';
COMMENT ON COLUMN groups.updated_at IS '그룹 정보·멤버십·역할·소유권이 마지막으로 변경된 시각';
COMMENT ON COLUMN groups.deleted_at IS '그룹 soft delete 시각';
COMMENT ON COLUMN groups.deleted_by_user_id IS '그룹 soft delete 실행자';

CREATE TABLE group_members (
  group_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'MEMBER',
  added_by_user_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by_user_id uuid,

  CONSTRAINT fk_group_members_group
    FOREIGN KEY (group_id) REFERENCES groups(group_id),
  CONSTRAINT fk_group_members_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_group_members_added_by
    FOREIGN KEY (added_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_group_members_removed_by
    FOREIGN KEY (removed_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT ck_group_members_role
    CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  CONSTRAINT ck_group_members_removed_pair
    CHECK (
      (removed_at IS NULL AND removed_by_user_id IS NULL)
      OR (removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_group_members_active_user
ON group_members(group_id, user_id)
WHERE removed_at IS NULL;

CREATE UNIQUE INDEX uq_group_members_active_owner
ON group_members(group_id)
WHERE role = 'OWNER' AND removed_at IS NULL;

CREATE INDEX idx_group_members_user_active
ON group_members(user_id, joined_at DESC)
WHERE removed_at IS NULL;

CREATE INDEX idx_group_members_group_active
ON group_members(group_id, joined_at ASC)
WHERE removed_at IS NULL;

COMMENT ON TABLE group_members IS '그룹 활성/과거 멤버십과 OWNER/ADMIN/MEMBER 역할';
COMMENT ON COLUMN group_members.group_member_id IS '멤버십 이력 PK(UUID)';
COMMENT ON COLUMN group_members.role IS '활성 역할: OWNER, ADMIN, MEMBER';
COMMENT ON COLUMN group_members.added_by_user_id IS '생성자는 본인, 초대 수락은 원래 초대자';
COMMENT ON COLUMN group_members.removed_at IS '멤버십 종료 시각. 재가입은 새 row로 기록';
COMMENT ON COLUMN group_members.removed_by_user_id IS '멤버십 종료 실행자';

CREATE TABLE group_invitations (
  invitation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  inviter_user_id uuid NOT NULL,
  invitee_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  message text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,

  CONSTRAINT fk_group_invitations_group
    FOREIGN KEY (group_id) REFERENCES groups(group_id),
  CONSTRAINT fk_group_invitations_inviter
    FOREIGN KEY (inviter_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_group_invitations_invitee
    FOREIGN KEY (invitee_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_group_invitations_status
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED', 'EXPIRED')),
  CONSTRAINT ck_group_invitations_not_self
    CHECK (inviter_user_id <> invitee_user_id),
  CONSTRAINT ck_group_invitations_expiry
    CHECK (expires_at > created_at),
  CONSTRAINT ck_group_invitations_response
    CHECK (
      (status = 'PENDING' AND responded_at IS NULL)
      OR (status <> 'PENDING' AND responded_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_group_invitations_pending
ON group_invitations(group_id, invitee_user_id)
WHERE status = 'PENDING';

CREATE INDEX idx_group_invitations_received
ON group_invitations(invitee_user_id, status, created_at DESC);

CREATE INDEX idx_group_invitations_group
ON group_invitations(group_id, status, created_at DESC);

COMMENT ON TABLE group_invitations IS '그룹 가입 초대. ACCEPTED 시 group_members 활성 row를 생성한다.';
COMMENT ON COLUMN group_invitations.status IS 'PENDING, ACCEPTED, REJECTED, CANCELED, EXPIRED';
COMMENT ON COLUMN group_invitations.message IS '초대자가 작성한 선택 메시지. 구조화 로그에 기록하지 않는다.';
COMMENT ON COLUMN group_invitations.expires_at IS '초대 만료 시각. 서비스가 TTL 환경변수로 계산';
COMMENT ON COLUMN group_invitations.responded_at IS '종료 상태로 전환된 시각';

-- =========================================================
-- 15) USER DEVICES / PUSH JOBS / PUSH DELIVERIES
-- notifications가 원본이고 Push Worker는 최신 활성 기기 한 대에 at-least-once 전달
-- =========================================================
CREATE TABLE user_devices (
  device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  user_id uuid,
  platform text NOT NULL,
  provider text NOT NULL DEFAULT 'FCM',
  provider_target text,
  target_type text NOT NULL DEFAULT 'FCM_TOKEN',
  push_permission_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  app_environment text NOT NULL,
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  target_updated_at timestamptz,
  disabled_reason text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_user_devices_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_user_devices_platform CHECK (platform IN ('ANDROID', 'IOS')),
  CONSTRAINT ck_user_devices_provider CHECK (provider = 'FCM'),
  CONSTRAINT ck_user_devices_target_type CHECK (target_type IN ('FCM_TOKEN', 'FID')),
  CONSTRAINT ck_user_devices_environment CHECK (app_environment IN ('STAGE', 'PROD')),
  CONSTRAINT ck_user_devices_target_permission CHECK (
    provider_target IS NULL OR push_permission_enabled = true
  )
);

CREATE UNIQUE INDEX uq_user_devices_environment_installation
ON user_devices(app_environment, installation_id);

CREATE UNIQUE INDEX uq_user_devices_environment_target
ON user_devices(app_environment, provider, provider_target)
WHERE provider_target IS NOT NULL;

CREATE INDEX idx_user_devices_latest_active
ON user_devices(
  user_id,
  app_environment,
  last_seen_at DESC,
  target_updated_at DESC,
  device_id ASC
)
WHERE is_active = true
  AND push_permission_enabled = true
  AND provider_target IS NOT NULL;

CREATE TABLE push_jobs (
  push_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
  receiver_user_id uuid NOT NULL,
  target_policy text NOT NULL DEFAULT 'LATEST_ACTIVE',
  title text NOT NULL,
  body text,
  data_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'HIGH',
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  cancellation_reason text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_push_jobs_notification
    FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_push_jobs_receiver
    FOREIGN KEY (receiver_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT uq_push_jobs_notification UNIQUE (notification_id),
  CONSTRAINT ck_push_jobs_policy CHECK (target_policy = 'LATEST_ACTIVE'),
  CONSTRAINT ck_push_jobs_priority CHECK (priority = 'HIGH'),
  CONSTRAINT ck_push_jobs_status CHECK (
    status IN ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'NO_TARGET', 'FAILED', 'EXPIRED', 'CANCELED')
  ),
  CONSTRAINT ck_push_jobs_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_push_jobs_lock_pair CHECK (
    (locked_by IS NULL AND lease_until IS NULL)
    OR (locked_by IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT ck_push_jobs_expiry CHECK (expires_at > created_at)
);

CREATE INDEX idx_push_jobs_claimable
ON push_jobs(available_at, created_at)
WHERE status IN ('PENDING', 'RETRY', 'PROCESSING');

CREATE INDEX idx_push_jobs_lease
ON push_jobs(lease_until)
WHERE status = 'PROCESSING';

CREATE TABLE push_deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  push_job_id uuid NOT NULL,
  device_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  provider_message_id text,
  target_hash text,
  error_code text,
  sending_started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_push_deliveries_job
    FOREIGN KEY (push_job_id) REFERENCES push_jobs(push_job_id) ON DELETE CASCADE,
  CONSTRAINT fk_push_deliveries_device
    FOREIGN KEY (device_id) REFERENCES user_devices(device_id) ON DELETE CASCADE,
  CONSTRAINT uq_push_deliveries_job_device UNIQUE (push_job_id, device_id),
  CONSTRAINT uq_push_deliveries_job UNIQUE (push_job_id),
  CONSTRAINT ck_push_deliveries_status CHECK (
    status IN ('PENDING', 'SENDING', 'SENT', 'RETRY', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT ck_push_deliveries_attempt_count CHECK (attempt_count >= 0)
);

CREATE INDEX idx_push_deliveries_retry
ON push_deliveries(next_retry_at)
WHERE status = 'RETRY';

COMMENT ON TABLE user_devices IS '앱 설치 단위 푸시 target. 사용자와 분리해 logout 후 안전하게 비활성화한다.';
COMMENT ON COLUMN user_devices.provider_target IS 'FCM registration token 또는 향후 FID. API 응답과 로그에 노출하지 않는다.';
COMMENT ON COLUMN user_devices.last_seen_at IS 'LATEST_ACTIVE 기기 선택의 1차 정렬 기준';
COMMENT ON TABLE push_jobs IS 'notifications와 같은 transaction에서 생성되는 at-least-once 푸시 outbox';
COMMENT ON COLUMN push_jobs.data_payload IS 'FCM data용 문자열 값만 포함한 navigation metadata';
COMMENT ON COLUMN push_jobs.cancel_requested_at IS '외부 전송 경합을 고려한 best-effort 취소 요청 시각';
COMMENT ON TABLE push_deliveries IS 'push job이 최초 선택한 단일 기기와 provider 전송 결과';
COMMENT ON COLUMN push_deliveries.target_hash IS '운영 추적용 SHA-256 target hash. raw target은 저장하지 않는다.';

-- 운영 권장 설정 예:
-- ALTER DATABASE shift_calendar SET timezone TO 'UTC';
