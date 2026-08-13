\set ON_ERROR_STOP on
\pset pager off

-- Usage:
--   psql "$DATABASE_URL" -X -v expected_database=shift_calendar_stage \
--     -v expect_apple_tables_empty=true -f migrations/apple_auth_postflight.sql

\if :{?expected_database}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset apple_postflight_

\if :apple_postflight_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

DO $apple_postflight$
DECLARE
  invalid_columns text[];
  invalid_constraints text[];
  invalid_indexes text[];
BEGIN
  IF to_regclass('public.oauth_login_challenges') IS NULL
     OR to_regclass('public.oauth_authorizations') IS NULL THEN
    RAISE EXCEPTION 'Apple postflight 실패: 대상 테이블 2개가 모두 존재하지 않습니다.';
  END IF;

  SELECT array_agg(format('%I.%I', required.table_name, required.column_name))
    INTO invalid_columns
  FROM (
    VALUES
      ('oauth_login_challenges', 'challenge_id', 'uuid', 'NO'),
      ('oauth_login_challenges', 'provider', 'text', 'NO'),
      ('oauth_login_challenges', 'platform', 'text', 'NO'),
      ('oauth_login_challenges', 'state_hash', 'character', 'NO'),
      ('oauth_login_challenges', 'nonce_hash', 'character', 'NO'),
      ('oauth_login_challenges', 'client_id', 'text', 'NO'),
      ('oauth_login_challenges', 'redirect_uri', 'text', 'YES'),
      ('oauth_login_challenges', 'expires_at', 'timestamp with time zone', 'NO'),
      ('oauth_login_challenges', 'consumed_at', 'timestamp with time zone', 'YES'),
      ('oauth_login_challenges', 'created_at', 'timestamp with time zone', 'NO'),
      ('oauth_authorizations', 'authorization_id', 'uuid', 'NO'),
      ('oauth_authorizations', 'user_id', 'uuid', 'NO'),
      ('oauth_authorizations', 'provider', 'text', 'NO'),
      ('oauth_authorizations', 'provider_subject', 'text', 'NO'),
      ('oauth_authorizations', 'client_id', 'text', 'NO'),
      ('oauth_authorizations', 'refresh_token_ciphertext', 'bytea', 'NO'),
      ('oauth_authorizations', 'refresh_token_iv', 'bytea', 'NO'),
      ('oauth_authorizations', 'refresh_token_auth_tag', 'bytea', 'NO'),
      ('oauth_authorizations', 'created_at', 'timestamp with time zone', 'NO'),
      ('oauth_authorizations', 'updated_at', 'timestamp with time zone', 'NO'),
      ('oauth_authorizations', 'revoked_at', 'timestamp with time zone', 'YES')
  ) AS required(table_name, column_name, data_type, is_nullable)
  LEFT JOIN information_schema.columns columns
    ON columns.table_schema = 'public'
   AND columns.table_name = required.table_name
   AND columns.column_name = required.column_name
  WHERE columns.column_name IS NULL
     OR columns.data_type <> required.data_type
     OR columns.is_nullable <> required.is_nullable;
  IF invalid_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Apple postflight 실패: 컬럼 타입/nullability 불일치: %', invalid_columns;
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('oauth_login_challenges', 'oauth_authorizations')
  ) <> 21 THEN
    RAISE EXCEPTION 'Apple postflight 실패: 대상 테이블 전체 컬럼 수가 21개가 아닙니다.';
  END IF;

  SELECT array_agg(format('%I.%I', required.table_name, required.constraint_name))
    INTO invalid_constraints
  FROM (
    VALUES
      ('oauth_login_challenges', 'oauth_login_challenges_pkey'),
      ('oauth_login_challenges', 'ck_oauth_challenge_provider'),
      ('oauth_login_challenges', 'ck_oauth_challenge_platform'),
      ('oauth_login_challenges', 'ck_oauth_challenge_state_hash'),
      ('oauth_login_challenges', 'ck_oauth_challenge_nonce_hash'),
      ('oauth_login_challenges', 'ck_oauth_challenge_expiry'),
      ('oauth_login_challenges', 'ck_oauth_challenge_redirect'),
      ('oauth_authorizations', 'oauth_authorizations_pkey'),
      ('oauth_authorizations', 'fk_oauth_authorizations_user'),
      ('oauth_authorizations', 'ck_oauth_authorizations_provider'),
      ('oauth_authorizations', 'uq_oauth_authorizations_subject_client')
  ) AS required(table_name, constraint_name)
  LEFT JOIN pg_constraint constraints
    ON constraints.conrelid = to_regclass(format('public.%I', required.table_name))
   AND constraints.conname = required.constraint_name
  WHERE constraints.oid IS NULL OR NOT constraints.convalidated;
  IF invalid_constraints IS NOT NULL THEN
    RAISE EXCEPTION 'Apple postflight 실패: 제약이 없거나 validate되지 않았습니다: %', invalid_constraints;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.oauth_authorizations'::regclass
      AND conname = 'fk_oauth_authorizations_user'
      AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'Apple postflight 실패: user FK가 ON DELETE CASCADE가 아닙니다.';
  END IF;

  SELECT array_agg(required.name ORDER BY required.name)
    INTO invalid_indexes
  FROM (
    VALUES
      ('oauth_login_challenges_pkey', true, false),
      ('uq_oauth_login_challenges_state', true, false),
      ('idx_oauth_login_challenges_cleanup', false, true),
      ('oauth_authorizations_pkey', true, false),
      ('uq_oauth_authorizations_subject_client', true, false),
      ('idx_oauth_authorizations_user_active', false, true)
  ) AS required(name, must_be_unique, must_be_partial)
  LEFT JOIN pg_class index_rel
    ON index_rel.relnamespace = 'public'::regnamespace
   AND index_rel.relname = required.name
   AND index_rel.relkind = 'i'
  LEFT JOIN pg_index indexes ON indexes.indexrelid = index_rel.oid
  WHERE index_rel.oid IS NULL
     OR NOT indexes.indisvalid
     OR NOT indexes.indisready
     OR (required.must_be_unique AND NOT indexes.indisunique)
     OR (required.must_be_partial AND indexes.indpred IS NULL);
  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Apple postflight 실패: index 속성 불일치: %', invalid_indexes;
  END IF;

  IF obj_description('public.oauth_login_challenges'::regclass, 'pg_class') IS NULL
     OR obj_description('public.oauth_authorizations'::regclass, 'pg_class') IS NULL THEN
    RAISE EXCEPTION 'Apple postflight 실패: 필수 table COMMENT가 없습니다.';
  END IF;
END;
$apple_postflight$;

-- 제약을 실제 INSERT로 확인하되 영구 데이터는 남기지 않습니다.
BEGIN;
INSERT INTO public.oauth_login_challenges (
  provider, platform, state_hash, nonce_hash, client_id, redirect_uri, expires_at
) VALUES (
  'APPLE', 'ios', repeat('a', 64), repeat('b', 64),
  'com.hspark.shiftmate', NULL, now() + interval '5 minutes'
);
ROLLBACK;

\if :{?expect_apple_tables_empty}
  \if :expect_apple_tables_empty
    DO $empty_check$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.oauth_login_challenges)
         OR EXISTS (SELECT 1 FROM public.oauth_authorizations) THEN
        RAISE EXCEPTION 'Apple postflight 실패: API 배포 전 신규 테이블에 데이터가 존재합니다.';
      END IF;
    END;
    $empty_check$;
  \endif
\endif

SELECT
  now() AS checked_at,
  current_database() AS database_name,
  (SELECT count(*) FROM public.oauth_login_challenges) AS challenge_count,
  (SELECT count(*) FROM public.oauth_authorizations) AS authorization_count;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('oauth_login_challenges', 'oauth_authorizations')
ORDER BY tablename, indexname;

\echo 'Apple auth migration strict postflight 통과'
