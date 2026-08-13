\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset google_rollback_

\if :google_rollback_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

\if :{?confirm_google_auth_disabled}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'confirm_google_auth_disabled 변수가 필요합니다.'; END $guard$;
\endif

\if :confirm_google_auth_disabled
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'GOOGLE_AUTH_ENABLED=false 확인이 필요합니다.'; END $guard$;
\endif

\if :{?confirm_google_auth_support_drop}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'confirm_google_auth_support_drop 변수가 필요합니다.'; END $guard$;
\endif

\if :confirm_google_auth_support_drop
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'Google auth schema 삭제가 승인되지 않았습니다.'; END $guard$;
\endif

DO $zero_row_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE google_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'Google auth rollback 중단: google_id 데이터가 존재합니다. 기능 플래그 비활성과 이전 서버 이미지만 사용하세요.';
  END IF;
END;
$zero_row_guard$;

BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX public.idx_users_google_id;
ALTER TABLE public.users DROP COLUMN google_id;
COMMIT;

\echo '빈 Google auth column/index 삭제 완료'
