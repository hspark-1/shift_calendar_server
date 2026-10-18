\set ON_ERROR_STOP on
-- Stop API writes and all deletion workers first. Preserve additive schema for code rollback.
-- Destructive schema rollback is permitted only when no recovery/audit state remains.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.account_deletion_requests IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE completed_at IS NULL
             OR image_scope IS NOT NULL OR images_purged_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.account_deletion_operator_actions) THEN
    RAISE EXCEPTION 'Recovery or audit state exists; keep additive schema';
  END IF;
END $$;
DROP INDEX public.idx_user_devices_detached_cleanup;
DROP TABLE public.account_deletion_operator_actions;
DROP TABLE public.privacy_worker_heartbeats;
ALTER TABLE public.account_deletion_requests DROP CONSTRAINT ck_deletion_image_scope,
  DROP COLUMN image_scope, DROP COLUMN images_purged_at;
COMMIT;
