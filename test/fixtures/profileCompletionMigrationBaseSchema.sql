DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
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
  CONSTRAINT ck_users_phone_format CHECK (
    phone IS NULL OR phone ~ '^[0-9]{3}-[0-9]{3,4}-[0-9]{4}$'
  ),
  CONSTRAINT ck_users_account_status CHECK (
    account_status IN ('ACTIVE', 'DELETION_PENDING')
  )
);

CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

INSERT INTO users (email, name, timezone, phone, created_at) VALUES
  ('backfill@example.com', '기존 완료 사용자', 'Asia/Seoul', '010-1111-2222', '2026-01-01T00:00:00Z'),
  ('invalid-timezone@example.com', '미완료 타임존', 'Invalid/Timezone', '010-2222-3333', '2026-01-02T00:00:00Z'),
  ('missing-phone@example.com', '미완료 번호', 'Asia/Seoul', NULL, '2026-01-03T00:00:00Z');
