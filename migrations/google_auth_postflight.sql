\set ON_ERROR_STOP on
\pset pager off

-- Usage:
--   psql "$DATABASE_URL" -X -v expected_database=shift_calendar_stage \
--     -f migrations/google_auth_postflight.sql

\if :{?expected_database}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset google_postflight_

\if :google_postflight_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

DO $google_postflight$
DECLARE
  google_id_data_type text;
  google_id_nullable text;
  google_index_unique boolean;
  google_index_valid boolean;
  google_index_ready boolean;
  google_index_predicate text;
  google_index_key text;
  duplicate_count bigint;
  google_id_comment text;
BEGIN
  SELECT data_type, is_nullable
    INTO google_id_data_type, google_id_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'google_id';

  IF google_id_data_type IS DISTINCT FROM 'text'
     OR google_id_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION
      'Google postflight 실패: users.google_id는 nullable text여야 합니다. actual=(%,%)',
      COALESCE(google_id_data_type, '<missing>'), COALESCE(google_id_nullable, '<missing>');
  END IF;

  SELECT indexes.indisunique, indexes.indisvalid, indexes.indisready,
         pg_get_expr(indexes.indpred, indexes.indrelid),
         pg_get_indexdef(indexes.indexrelid, 1, false)
    INTO google_index_unique, google_index_valid, google_index_ready,
         google_index_predicate, google_index_key
  FROM pg_class index_rel
  JOIN pg_index indexes ON indexes.indexrelid = index_rel.oid
  WHERE index_rel.relnamespace = 'public'::regnamespace
    AND index_rel.relname = 'idx_users_google_id'
    AND index_rel.relkind = 'i';

  IF google_index_unique IS DISTINCT FROM true
     OR google_index_valid IS DISTINCT FROM true
     OR google_index_ready IS DISTINCT FROM true
     OR google_index_key IS DISTINCT FROM 'google_id'
     OR google_index_predicate IS NULL
     OR regexp_replace(google_index_predicate, '[()[:space:]]', '', 'g') <> 'google_idISNOTNULL' THEN
    RAISE EXCEPTION
      'Google postflight 실패: idx_users_google_id 속성이 불일치합니다. key=% predicate=%',
      COALESCE(google_index_key, '<missing>'), COALESCE(google_index_predicate, '<missing>');
  END IF;

  SELECT col_description('public.users'::regclass, attributes.attnum)
    INTO google_id_comment
  FROM pg_attribute attributes
  WHERE attributes.attrelid = 'public.users'::regclass
    AND attributes.attname = 'google_id'
    AND NOT attributes.attisdropped;
  IF google_id_comment IS DISTINCT FROM
     'Google OIDC subject(sub). 검증된 ID Token에서만 저장' THEN
    RAISE EXCEPTION 'Google postflight 실패: users.google_id COMMENT가 없거나 불일치합니다.';
  END IF;

  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT google_id
    FROM public.users
    WHERE google_id IS NOT NULL
    GROUP BY google_id
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count <> 0 THEN
    RAISE EXCEPTION 'Google postflight 실패: non-null google_id 중복이 %건입니다.', duplicate_count;
  END IF;
END;
$google_postflight$;

SELECT
  now() AS checked_at,
  current_database() AS database_name,
  count(*) FILTER (WHERE google_id IS NOT NULL) AS google_user_count,
  count(*) FILTER (WHERE google_id IS NULL) AS non_google_user_count
FROM public.users;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_users_google_id';

\echo 'Google auth migration strict postflight 통과'
