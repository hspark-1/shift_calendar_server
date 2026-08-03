BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE IF NOT EXISTS user_devices (
  device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  user_id uuid,
  platform text NOT NULL,
  provider text NOT NULL DEFAULT 'FCM',
  provider_target text,
  target_type text NOT NULL DEFAULT 'FCM_TOKEN',
  push_permission_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  app_environment text NOT NULL,
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  target_updated_at timestamptz,
  disabled_reason text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_user_devices_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_user_devices_platform CHECK (platform IN ('ANDROID', 'IOS')),
  CONSTRAINT ck_user_devices_provider CHECK (provider = 'FCM'),
  CONSTRAINT ck_user_devices_target_type CHECK (target_type IN ('FCM_TOKEN', 'FID')),
  CONSTRAINT ck_user_devices_environment CHECK (app_environment IN ('STAGE', 'PROD')),
  CONSTRAINT ck_user_devices_target_permission CHECK (
    provider_target IS NULL OR push_permission_enabled = true
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_environment_installation
ON user_devices(app_environment, installation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_devices_environment_target
ON user_devices(app_environment, provider, provider_target)
WHERE provider_target IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_devices_latest_active
ON user_devices(
  user_id,
  app_environment,
  last_seen_at DESC,
  target_updated_at DESC,
  device_id ASC
)
WHERE is_active = true
  AND push_permission_enabled = true
  AND provider_target IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_jobs (
  push_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
  receiver_user_id uuid NOT NULL,
  target_policy text NOT NULL DEFAULT 'LATEST_ACTIVE',
  title text NOT NULL,
  body text,
  data_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'HIGH',
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  lease_until timestamptz,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  cancellation_reason text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_push_jobs_notification
    FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_push_jobs_receiver
    FOREIGN KEY (receiver_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT uq_push_jobs_notification UNIQUE (notification_id),
  CONSTRAINT ck_push_jobs_policy CHECK (target_policy = 'LATEST_ACTIVE'),
  CONSTRAINT ck_push_jobs_priority CHECK (priority = 'HIGH'),
  CONSTRAINT ck_push_jobs_status CHECK (
    status IN ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'NO_TARGET', 'FAILED', 'EXPIRED', 'CANCELED')
  ),
  CONSTRAINT ck_push_jobs_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_push_jobs_lock_pair CHECK (
    (locked_by IS NULL AND lease_until IS NULL)
    OR (locked_by IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CONSTRAINT ck_push_jobs_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_push_jobs_claimable
ON push_jobs(available_at, created_at)
WHERE status IN ('PENDING', 'RETRY', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_push_jobs_lease
ON push_jobs(lease_until)
WHERE status = 'PROCESSING';

CREATE TABLE IF NOT EXISTS push_deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  push_job_id uuid NOT NULL,
  device_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  provider_message_id text,
  target_hash text,
  error_code text,
  sending_started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_push_deliveries_job
    FOREIGN KEY (push_job_id) REFERENCES push_jobs(push_job_id) ON DELETE CASCADE,
  CONSTRAINT fk_push_deliveries_device
    FOREIGN KEY (device_id) REFERENCES user_devices(device_id),
  CONSTRAINT uq_push_deliveries_job_device UNIQUE (push_job_id, device_id),
  CONSTRAINT uq_push_deliveries_job UNIQUE (push_job_id),
  CONSTRAINT ck_push_deliveries_status CHECK (
    status IN ('PENDING', 'SENDING', 'SENT', 'RETRY', 'FAILED', 'SKIPPED')
  ),
  CONSTRAINT ck_push_deliveries_attempt_count CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_retry
ON push_deliveries(next_retry_at)
WHERE status = 'RETRY';

COMMENT ON TABLE user_devices IS '앱 설치 단위 푸시 target. 사용자와 분리해 logout 후 안전하게 비활성화한다.';
COMMENT ON COLUMN user_devices.provider_target IS 'FCM registration token 또는 향후 FID. API 응답과 로그에 노출하지 않는다.';
COMMENT ON COLUMN user_devices.last_seen_at IS 'LATEST_ACTIVE 기기 선택의 1차 정렬 기준';
COMMENT ON TABLE push_jobs IS 'notifications와 같은 transaction에서 생성되는 at-least-once 푸시 outbox';
COMMENT ON COLUMN push_jobs.data_payload IS 'FCM data용 문자열 값만 포함한 navigation metadata';
COMMENT ON COLUMN push_jobs.cancel_requested_at IS '외부 전송 경합을 고려한 best-effort 취소 요청 시각';
COMMENT ON TABLE push_deliveries IS 'push job이 최초 선택한 단일 기기와 provider 전송 결과';
COMMENT ON COLUMN push_deliveries.target_hash IS '운영 추적용 SHA-256 target hash. raw target은 저장하지 않는다.';

COMMIT;
