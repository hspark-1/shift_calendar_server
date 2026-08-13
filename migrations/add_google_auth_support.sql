\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE users
ADD COLUMN google_id text;

CREATE UNIQUE INDEX idx_users_google_id
ON users(google_id)
WHERE google_id IS NOT NULL;

COMMENT ON COLUMN users.google_id IS
  'Google OIDC subject(sub). 검증된 ID Token에서만 저장';

COMMIT;
