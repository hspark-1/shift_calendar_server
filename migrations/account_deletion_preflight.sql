\set ON_ERROR_STOP on

SELECT current_database() AS database_name,
       current_setting('server_version_num')::integer AS server_version_num,
       pg_is_in_recovery() AS is_replica;

DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION '회원 탈퇴 migration은 PostgreSQL 16 이상이 필요합니다.';
  END IF;
  IF pg_is_in_recovery() THEN
    RAISE EXCEPTION 'read replica에는 migration을 적용할 수 없습니다.';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'public.users가 없습니다.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name IN ('account_status', 'deletion_requested_at')
  ) OR to_regclass('public.account_deletion_requests') IS NOT NULL
     OR to_regclass('public.account_deletion_provider_tasks') IS NOT NULL THEN
    RAISE EXCEPTION '회원 탈퇴 schema가 이미 또는 부분 적용되어 있습니다.';
  END IF;
END
$$;

SELECT conrelid::regclass AS referencing_table,
       a.attname AS referencing_column,
       confdeltype AS delete_action,
       conname
FROM pg_constraint c
JOIN unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
ORDER BY 1::text, 2;
