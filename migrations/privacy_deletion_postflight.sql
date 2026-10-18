\set ON_ERROR_STOP on
BEGIN;
SELECT image_scope, images_purged_at FROM public.account_deletion_requests LIMIT 0;
SELECT worker_name, last_seen_at FROM public.privacy_worker_heartbeats LIMIT 0;
SELECT action_id, deletion_request_id, actor, reason, previous_status, previous_attempt_count, created_at
FROM public.account_deletion_operator_actions LIMIT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.account_deletion_requests'::regclass
                 AND conname = 'ck_deletion_image_scope' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.account_deletion_operator_actions'::regclass
                      AND confrelid = 'public.account_deletion_requests'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'Privacy constraints missing';
  END IF;
END $$;
SELECT 'privacy_deletion_postflight_ok' AS result;
COMMIT;
