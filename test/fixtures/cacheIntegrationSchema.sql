-- 캐시 통합 테스트 전용 최소 PostgreSQL schema.
-- RUN_CACHE_INTEGRATION=true인 격리 DB에서만 실행하며 운영 DB에는 사용하지 않는다.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  profile_image_url text,
  timezone text,
  kakao_id text UNIQUE,
  apple_id text UNIQUE,
  naver_id text UNIQUE,
  password text,
  phone text UNIQUE,
  account_status text NOT NULL DEFAULT 'ACTIVE',
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE friendships (
  user_id_a uuid NOT NULL REFERENCES users(user_id),
  user_id_b uuid NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id_a, user_id_b),
  CHECK (user_id_a < user_id_b)
);

CREATE TABLE friend_level_settings (
  owner_user_id uuid NOT NULL REFERENCES users(user_id),
  friend_user_id uuid NOT NULL REFERENCES users(user_id),
  can_view boolean NOT NULL DEFAULT true,
  friend_level smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, friend_user_id),
  CHECK (owner_user_id <> friend_user_id),
  CHECK (friend_level >= 0)
);

CREATE TABLE shift_templates (
  template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(user_id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_user_id, name)
);

CREATE TABLE shift_template_versions (
  template_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES shift_templates(template_id),
  version_no integer NOT NULL CHECK (version_no > 0),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_by_user_id uuid NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_no),
  UNIQUE (template_id, effective_from)
);

CREATE TABLE shift_types (
  shift_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES shift_templates(template_id),
  code text NOT NULL,
  name text NOT NULL,
  color text,
  base_color text,
  color_intensity smallint NOT NULL DEFAULT 100 CHECK (color_intensity BETWEEN 0 AND 100),
  sort_order smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE shift_type_schedules (
  schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_type_id uuid NOT NULL REFERENCES shift_types(shift_type_id),
  template_version_id uuid NOT NULL REFERENCES shift_template_versions(template_version_id),
  start_time time,
  end_time time,
  crosses_midnight boolean NOT NULL DEFAULT false,
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_version_id, shift_type_id),
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

CREATE TABLE events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(user_id),
  created_by_user_id uuid NOT NULL REFERENCES users(user_id),
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
  deleted_by_user_id uuid REFERENCES users(user_id),
  CHECK (start_at < end_at),
  CHECK (visibility_level >= 0)
);

CREATE TABLE work_shifts (
  work_shift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(user_id),
  work_date date NOT NULL,
  schedule_id uuid NOT NULL REFERENCES shift_type_schedules(schedule_id),
  note text,
  visibility_level smallint NOT NULL DEFAULT 0 CHECK (visibility_level = 0),
  created_by_user_id uuid NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(user_id),
  UNIQUE (owner_user_id, work_date)
);

CREATE TABLE work_shift_month_states (
  owner_user_id uuid NOT NULL REFERENCES users(user_id),
  year_month date NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  last_modified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, year_month),
  CHECK (year_month = date_trunc('month', year_month)::date)
);

CREATE TABLE work_shift_cache_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'WORK_SHIFT_MONTH_CHANGED',
  owner_user_id uuid NOT NULL REFERENCES users(user_id),
  year_month date NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  last_error_code text,
  CHECK (event_type = 'WORK_SHIFT_MONTH_CHANGED'),
  CHECK (year_month = date_trunc('month', year_month)::date),
  CHECK (revision > 0),
  CHECK (attempt_count >= 0),
  CHECK (
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

CREATE VIEW v_visible_events_for_friend AS
SELECT e.*, fls.friend_user_id AS viewer_user_id
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
