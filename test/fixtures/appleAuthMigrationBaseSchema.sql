-- Apple auth migration pre/postflight 전용 최소 PostgreSQL 16 기반 schema.
-- 격리된 shift_calendar_group_debug 테스트 DB에서만 사용한다.

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

CREATE UNIQUE INDEX idx_users_apple_id
ON users(apple_id)
WHERE apple_id IS NOT NULL;
