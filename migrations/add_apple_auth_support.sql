\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE oauth_login_challenges (
  challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  platform text NOT NULL,
  state_hash char(64) NOT NULL,
  nonce_hash char(64) NOT NULL,
  client_id text NOT NULL,
  redirect_uri text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_oauth_challenge_provider CHECK (provider = 'APPLE'),
  CONSTRAINT ck_oauth_challenge_platform CHECK (platform IN ('ios', 'android')),
  CONSTRAINT ck_oauth_challenge_state_hash CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_oauth_challenge_nonce_hash CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_oauth_challenge_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_oauth_challenge_redirect CHECK (
    (platform = 'ios' AND redirect_uri IS NULL)
    OR (platform = 'android' AND redirect_uri IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_oauth_login_challenges_state
ON oauth_login_challenges(state_hash);

CREATE INDEX idx_oauth_login_challenges_cleanup
ON oauth_login_challenges(expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE oauth_authorizations (
  authorization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  client_id text NOT NULL,
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_iv bytea NOT NULL,
  refresh_token_auth_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,

  CONSTRAINT fk_oauth_authorizations_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT ck_oauth_authorizations_provider CHECK (provider = 'APPLE'),
  CONSTRAINT uq_oauth_authorizations_subject_client
    UNIQUE (provider, provider_subject, client_id)
);

CREATE INDEX idx_oauth_authorizations_user_active
ON oauth_authorizations(user_id, provider)
WHERE revoked_at IS NULL;

COMMENT ON TABLE oauth_login_challenges IS
  '소셜 로그인 전 일회성 state/nonce hash. 원문 credential은 저장하지 않는다.';
COMMENT ON TABLE oauth_authorizations IS
  '외부 OAuth 연결과 계정 삭제용 refresh token 암호문. 앱 JWT refresh_tokens와 분리한다.';

COMMIT;
