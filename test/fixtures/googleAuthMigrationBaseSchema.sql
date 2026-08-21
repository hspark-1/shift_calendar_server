-- Google auth migration/transaction 통합 테스트 전용 최소 PostgreSQL 16 schema.
-- 고정 격리 DB에서만 실행하며 운영 DB에는 사용하지 않는다.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  profile_image_url text,
  timezone text,
  job_type varchar(20),
  workplace varchar(100),
  profile_completed_at timestamptz,
  kakao_id text,
  apple_id text,
  naver_id text,
  phone text,
  password text,
  account_status text NOT NULL DEFAULT 'ACTIVE',
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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
  version_no integer NOT NULL,
  effective_from date NOT NULL,
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
  color_intensity smallint NOT NULL DEFAULT 100,
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
  duration_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_version_id, shift_type_id)
);

CREATE TABLE refresh_tokens (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  device_info text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_refresh_tokens_hash
ON refresh_tokens(token_hash)
WHERE revoked_at IS NULL;
