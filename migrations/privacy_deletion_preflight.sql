\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 160000 OR pg_is_in_recovery() THEN
    RAISE EXCEPTION 'PostgreSQL 16+ writable primary required';
  END IF;
  IF to_regclass('public.account_deletion_requests') IS NULL
     OR to_regclass('public.account_deletion_provider_tasks') IS NULL THEN
    RAISE EXCEPTION 'Apply account deletion base migration first';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'account_deletion_requests'
               AND column_name IN ('image_scope', 'images_purged_at'))
     OR to_regclass('public.privacy_worker_heartbeats') IS NOT NULL
     OR to_regclass('public.account_deletion_operator_actions') IS NOT NULL THEN
    RAISE EXCEPTION 'Privacy controls already or partially applied; inspect before retry';
  END IF;
END $$;
SELECT status, count(*) AS request_count,
       count(*) FILTER (WHERE db_purged_at IS NOT NULL) AS db_already_purged
FROM public.account_deletion_requests GROUP BY status;
COMMIT;
