\set ON_ERROR_STOP on
\pset pager off

-- Usage:
--   psql "$DATABASE_URL" -X -v expected_database=shift_calendar_stage \
--     -f migrations/apple_auth_preflight.sql

\if :{?expected_database}
\else
  \echo 'expected_database 변수가 필요합니다.'
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset apple_preflight_

\if :apple_preflight_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

DO $apple_preflight$
DECLARE
  conflicting_relations text[];
  conflicting_indexes text[];
  apple_id_data_type text;
  apple_id_nullable text;
  apple_index_unique boolean;
  apple_index_valid boolean;
  apple_index_ready boolean;
  apple_index_predicate text;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN
    RAISE EXCEPTION 'Apple preflight 실패: PostgreSQL 16이 필요합니다. 현재=%', current_setting('server_version');
  END IF;
  IF pg_is_in_recovery() OR current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'Apple preflight 실패: 쓰기 가능한 primary 연결이 아닙니다.';
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Apple preflight 실패: public schema CREATE 권한이 없습니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'Apple preflight 실패: pgcrypto extension이 없습니다.';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Apple preflight 실패: public.users가 없습니다.';
  END IF;
  IF NOT has_table_privilege(current_user, 'public.users', 'REFERENCES') THEN
    RAISE EXCEPTION 'Apple preflight 실패: users REFERENCES 권한이 없습니다.';
  END IF;

  SELECT data_type, is_nullable
    INTO apple_id_data_type, apple_id_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'apple_id';

  IF apple_id_data_type IS DISTINCT FROM 'text'
     OR apple_id_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION
      'Apple preflight 실패: users.apple_id는 nullable text여야 합니다. actual=(%,%)',
      COALESCE(apple_id_data_type, '<missing>'), COALESCE(apple_id_nullable, '<missing>');
  END IF;

  SELECT indexes.indisunique, indexes.indisvalid, indexes.indisready,
         pg_get_expr(indexes.indpred, indexes.indrelid)
    INTO apple_index_unique, apple_index_valid, apple_index_ready, apple_index_predicate
  FROM pg_class index_rel
  JOIN pg_index indexes ON indexes.indexrelid = index_rel.oid
  WHERE index_rel.relnamespace = 'public'::regnamespace
    AND index_rel.relname = 'idx_users_apple_id'
    AND index_rel.relkind = 'i';

  IF apple_index_unique IS DISTINCT FROM true
     OR apple_index_valid IS DISTINCT FROM true
     OR apple_index_ready IS DISTINCT FROM true
     OR apple_index_predicate IS NULL
     OR regexp_replace(apple_index_predicate, '[()[:space:]]', '', 'g') <> 'apple_idISNOTNULL' THEN
    RAISE EXCEPTION
      'Apple preflight 실패: idx_users_apple_id는 valid/ready unique partial index여야 합니다. predicate=%',
      COALESCE(apple_index_predicate, '<missing>');
  END IF;

  SELECT array_agg(target.name ORDER BY target.name)
    INTO conflicting_relations
  FROM (VALUES ('oauth_login_challenges'), ('oauth_authorizations')) AS target(name)
  WHERE to_regclass(format('public.%I', target.name)) IS NOT NULL;
  IF conflicting_relations IS NOT NULL THEN
    RAISE EXCEPTION 'Apple preflight 실패: 대상 relation이 이미 존재합니다: %', conflicting_relations;
  END IF;

  SELECT array_agg(target.name ORDER BY target.name)
    INTO conflicting_indexes
  FROM (
    VALUES
      ('uq_oauth_login_challenges_state'),
      ('idx_oauth_login_challenges_cleanup'),
      ('uq_oauth_authorizations_subject_client'),
      ('idx_oauth_authorizations_user_active')
  ) AS target(name)
  WHERE to_regclass(format('public.%I', target.name)) IS NOT NULL;
  IF conflicting_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Apple preflight 실패: 생성할 index 이름이 충돌합니다: %', conflicting_indexes;
  END IF;
END;
$apple_preflight$;

SELECT
  now() AS checked_at,
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port,
  current_setting('server_version') AS server_version,
  pg_is_in_recovery() AS is_in_recovery,
  current_setting('transaction_read_only') AS transaction_read_only;

\echo 'Apple auth migration read-only preflight 통과'
