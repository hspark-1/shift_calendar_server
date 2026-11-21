-- Additive migration. Apply to the selected database before the API release.
-- No phone/profile completion backfill, seed or schema reset.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verification_generation bigint NOT NULL DEFAULT 0 CHECK (phone_verification_generation >= 0);
CREATE TABLE IF NOT EXISTS public.phone_verifications (
  challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('SIGNUP', 'PHONE_CHANGE')),
  phone text NOT NULL CHECK (phone ~ '^01[016789]-[0-9]{3,4}-[0-9]{4}$'),
  phone_e164 text NOT NULL CHECK (phone_e164 = '+82' || substring(replace(phone, '-', '') from 2)),
  generation bigint NOT NULL CHECK (generation > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  retained_until timestamptz NOT NULL CHECK (retained_until >= expires_at + interval '24 hours'),
  cancelled_at timestamptz,
  challenge_key uuid NOT NULL,
  challenge_fingerprint char(64) NOT NULL,
  fingerprint_key_version text NOT NULL,
  verify_key uuid,
  verify_fingerprint char(64),
  verified_at timestamptz,
  proof_id uuid UNIQUE,
  proof_token_hash char(64),
  proof_key_version text,
  proof_expires_at timestamptz,
  consumed_at timestamptz,
  UNIQUE (user_id, generation),
  UNIQUE (user_id, challenge_key),
  UNIQUE (user_id, verify_key),
  CONSTRAINT ck_phone_verified_fields CHECK (
    (verified_at IS NULL AND verify_key IS NULL AND verify_fingerprint IS NULL AND proof_id IS NULL AND proof_token_hash IS NULL AND proof_key_version IS NULL AND proof_expires_at IS NULL AND consumed_at IS NULL)
    OR (verified_at IS NOT NULL AND verify_key IS NOT NULL AND verify_fingerprint IS NOT NULL AND proof_id IS NOT NULL AND proof_token_hash IS NOT NULL AND proof_key_version IS NOT NULL AND proof_expires_at > verified_at)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_verifications_active ON public.phone_verifications(user_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_phone_verifications_cleanup ON public.phone_verifications(retained_until);
CREATE TABLE IF NOT EXISTS public.profile_mutation_receipts (
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('COMPLETE', 'UPDATE')),
  request_fingerprint char(64) NOT NULL,
  fingerprint_key_version text NOT NULL,
  verification_id uuid UNIQUE REFERENCES public.phone_verifications(challenge_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  retained_until timestamptz NOT NULL CHECK (retained_until >= created_at + interval '24 hours'),
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_profile_mutation_receipts_cleanup ON public.profile_mutation_receipts(retained_until);
-- No user/UID/phone/raw token: claims survive account deletion for replay prevention.
CREATE TABLE IF NOT EXISTS public.phone_verification_events (
  event_hash char(64) PRIMARY KEY CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  retained_until timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phone_verification_events_cleanup ON public.phone_verification_events(retained_until);
CREATE TABLE IF NOT EXISTS public.phone_verification_rate_limits (
  scope_hash char(64) NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope_hash, window_start)
);
CREATE INDEX IF NOT EXISTS idx_phone_verification_rate_cleanup ON public.phone_verification_rate_limits(expires_at);
COMMENT ON COLUMN public.users.phone_verified_at IS 'Firebase 번호 증명을 프로필 transaction에서 소비한 시각. 기존/OAuth 번호는 backfill하지 않음';
COMMENT ON TABLE public.phone_verifications IS '앱 JWT 사용자별 최신 번호 challenge와 단일 소비 저장 증명. Firebase 원문 token/UID를 저장하지 않음';
COMMENT ON TABLE public.profile_mutation_receipts IS '프로필 commit 응답 유실 복구용 24시간 멱등 영수증';
COMMENT ON TABLE public.phone_verification_events IS '인증 이벤트 HMAC의 전 사용자 unique claim. 키 교체 digest들을 함께 보관';
COMMENT ON TABLE public.phone_verification_rate_limits IS 'Redis 캐시와 독립적인 PostgreSQL 다중 API 인스턴스 인증 제한';
COMMIT;
