\set ON_ERROR_STOP on
\pset pager off

\if :{?expected_database}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'expected_database 변수가 필요합니다.'; END $guard$;
\endif

SELECT current_database() = :'expected_database' AS database_matches
\gset apple_rollback_

\if :apple_rollback_database_matches
\else
  DO $guard$ BEGIN RAISE EXCEPTION '대상 DB 이름이 expected_database와 다릅니다.'; END $guard$;
\endif

\if :{?confirm_apple_auth_support_drop}
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'confirm_apple_auth_support_drop 변수가 필요합니다.'; END $guard$;
\endif

\if :confirm_apple_auth_support_drop
\else
  DO $guard$ BEGIN RAISE EXCEPTION 'Apple auth 테이블 삭제가 승인되지 않았습니다.'; END $guard$;
\endif

DO $zero_row_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.oauth_login_challenges)
     OR EXISTS (SELECT 1 FROM public.oauth_authorizations) THEN
    RAISE EXCEPTION
      'Apple auth rollback 중단: 두 테이블이 모두 0건이어야 합니다. 기능 플래그 비활성만 사용하세요.';
  END IF;
END;
$zero_row_guard$;

BEGIN;
DROP TABLE public.oauth_authorizations;
DROP TABLE public.oauth_login_challenges;
COMMIT;

\echo 'Apple auth 빈 테이블 삭제 완료'
