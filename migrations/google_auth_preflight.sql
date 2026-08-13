\set ON_ERROR_STOP on
\pset pager off

-- Usage:
--   psql "$DATABASE_URL" -X -v expected_database=shift_calendar_stage \
--     -f migrations/google_auth_preflight.sql

\if :{?expected_database}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset google_preflight_

\if :google_preflight_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

DO $google_preflight$
DECLARE
  users_owner oid;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN
    RAISE EXCEPTION 'Google preflight 실패: PostgreSQL 16이 필요합니다. 현재=%', current_setting('server_version');
  END IF;
  IF pg_is_in_recovery() OR current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'Google preflight 실패: 쓰기 가능한 primary 연결이 아닙니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'Google preflight 실패: pgcrypto extension이 없습니다.';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Google preflight 실패: public.users가 없습니다.';
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Google preflight 실패: public schema CREATE 권한이 없습니다.';
  END IF;

  SELECT relowner INTO users_owner
  FROM pg_class
  WHERE oid = 'public.users'::regclass;
  IF NOT pg_has_role(current_user, users_owner, 'USAGE') THEN
    RAISE EXCEPTION 'Google preflight 실패: public.users ALTER 권한을 위한 소유 역할 권한이 없습니다.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'google_id'
  ) THEN
    RAISE EXCEPTION 'Google preflight 실패: users.google_id 컬럼이 이미 존재합니다.';
  END IF;
  IF to_regclass('public.idx_users_google_id') IS NOT NULL THEN
    RAISE EXCEPTION 'Google preflight 실패: idx_users_google_id relation 이름이 이미 존재합니다.';
  END IF;
END;
$google_preflight$;

SELECT
  now() AS checked_at,
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port,
  current_setting('server_version') AS server_version,
  pg_is_in_recovery() AS is_in_recovery,
  current_setting('transaction_read_only') AS transaction_read_only;

\echo 'Google auth migration read-only preflight 통과'
