\set ON_ERROR_STOP on

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('users', 'account_status'),
    ('users', 'deletion_requested_at'),
    ('account_deletion_requests', 'deletion_request_id'),
    ('account_deletion_provider_tasks', 'provider_task_id')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = expected.table_name
      AND c.column_name = expected.column_name
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '회원 탈퇴 postflight 실패: 필수 컬럼 %개 누락', missing_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_account_deletion_requests_active_user'
  ) THEN
    RAISE EXCEPTION '회원 탈퇴 postflight 실패: active request unique index 누락';
  END IF;
END
$$;

SELECT 'account_deletion_postflight_ok' AS result;
