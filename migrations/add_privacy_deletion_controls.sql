BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

ALTER TABLE account_deletion_requests
  ADD COLUMN image_scope jsonb,
  ADD COLUMN images_purged_at timestamptz,
  ADD CONSTRAINT ck_deletion_image_scope CHECK (
    image_scope IS NULL OR (
      jsonb_typeof(image_scope) = 'object'
      AND image_scope ?& ARRAY['bucket', 'prefix', 'storage_fingerprint']
      AND jsonb_typeof(image_scope->'bucket') = 'string'
      AND jsonb_typeof(image_scope->'prefix') = 'string'
      AND jsonb_typeof(image_scope->'storage_fingerprint') = 'string'
      AND image_scope->>'storage_fingerprint' ~ '^[0-9a-f]{64}$'
    )
  );

CREATE INDEX idx_user_devices_detached_cleanup ON user_devices(disabled_at, updated_at)
WHERE user_id IS NULL AND provider_target IS NULL AND is_active = false;

CREATE TABLE privacy_worker_heartbeats (
  worker_name text PRIMARY KEY CHECK (worker_name IN ('account-deletion', 'push')),
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE account_deletion_operator_actions (
  action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_request_id uuid NOT NULL REFERENCES account_deletion_requests(deletion_request_id) ON DELETE CASCADE,
  actor text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('PROVIDER_FIXED', 'STORAGE_FIXED', 'REDIS_FIXED', 'WORKER_RECOVERED')),
  previous_status text NOT NULL,
  previous_attempt_count integer NOT NULL CHECK (previous_attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deletion_operator_actions_request
  ON account_deletion_operator_actions(deletion_request_id, created_at);
COMMENT ON COLUMN account_deletion_requests.image_scope IS 'Trusted bucket/prefix/config fingerprint captured before DB purge; cleared on completion. Never derived from a client URL.';
COMMENT ON COLUMN account_deletion_requests.images_purged_at IS 'All managed objects and versions under the captured account prefix were verified absent.';
COMMENT ON TABLE privacy_worker_heartbeats IS 'Successful account deletion loop heartbeat; external monitor must inspect staleness.';
COMMENT ON TABLE account_deletion_operator_actions IS 'Privileged manual retry audit, deleted with the parent request retention cleanup.';
COMMIT;
