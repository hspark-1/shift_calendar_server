const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const repository_root = path.resolve(__dirname, "..");
const temporary_directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "shiftmate-apple-auth-"),
);
const ec_keys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const private_key_path = path.join(temporary_directory, "AuthKey_TEST.p8");
fs.writeFileSync(
  private_key_path,
  ec_keys.privateKey.export({ type: "pkcs8", format: "pem" }),
  { mode: 0o600 },
);

process.env.APPLE_AUTH_ENABLED = "true";
process.env.APPLE_TEAM_ID = "TEAMID1234";
process.env.APPLE_KEY_ID = "KEYID12345";
process.env.APPLE_IOS_CLIENT_ID = "com.hspark.shiftmate";
process.env.APPLE_SERVICE_ID = "com.hspark.shiftmate.stage.web";
process.env.APPLE_REDIRECT_URI =
  "https://stage-api.shiftmate.co.kr/api/v1/auth/apple/callback";
process.env.APPLE_PRIVATE_KEY_PATH = private_key_path;
process.env.APPLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APPLE_CHALLENGE_TTL_SECONDS = "300";
process.env.APPLE_JWKS_CACHE_SECONDS = "21600";
process.env.JWT_SECRET = "apple-test-access-secret";
process.env.JWT_REFRESH_SECRET = "apple-test-refresh-secret";

const {
  AppleAuthError,
  AppleService,
} = require("../dist/services/appleService.js");
const {
  validateAppleAuthEnvironment,
} = require("../dist/config/environment.js");

test.after(() => {
  fs.rmSync(temporary_directory, { recursive: true, force: true });
});

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

test("Apple 환경 검증은 exact iOS client와 HTTPS callback, 32바이트 키를 강제한다", () => {
  assert.doesNotThrow(() => validateAppleAuthEnvironment());

  const original_redirect_uri = process.env.APPLE_REDIRECT_URI;
  process.env.APPLE_REDIRECT_URI =
    "https://127.0.0.1/api/v1/auth/apple/callback";
  assert.throws(
    () => validateAppleAuthEnvironment(),
    /도메인 기반 HTTPS/,
  );
  process.env.APPLE_REDIRECT_URI = original_redirect_uri;

  const original_encryption_key = process.env.APPLE_TOKEN_ENCRYPTION_KEY;
  process.env.APPLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(31).toString("base64");
  assert.throws(
    () => validateAppleAuthEnvironment(),
    /정확히 32바이트/,
  );
  process.env.APPLE_TOKEN_ENCRYPTION_KEY = original_encryption_key;
});

test("iOS와 Android client_id/redirect_uri를 서버 환경설정에서만 결정한다", () => {
  const service = new AppleService();
  assert.deepEqual(service.resolveAppleClient("ios"), {
    client_id: "com.hspark.shiftmate",
    redirect_uri: null,
  });
  assert.deepEqual(service.resolveAppleClient("android"), {
    client_id: "com.hspark.shiftmate.stage.web",
    redirect_uri:
      "https://stage-api.shiftmate.co.kr/api/v1/auth/apple/callback",
  });
  assert.throws(
    () => service.resolveAppleClient("web"),
    (error) =>
      error instanceof AppleAuthError && error.code === "APPLE_INVALID_PLATFORM",
  );
});

test("Apple client secret은 ES256, kid/iss/sub/aud와 5분 만료를 사용한다", () => {
  const service = new AppleService();
  const client_secret = service.generateClientSecret(
    "com.hspark.shiftmate.stage.web",
  );
  const decoded = jwt.decode(client_secret, { complete: true });
  assert.equal(decoded.header.alg, "ES256");
  assert.equal(decoded.header.kid, "KEYID12345");
  assert.equal(decoded.payload.iss, "TEAMID1234");
  assert.equal(decoded.payload.sub, "com.hspark.shiftmate.stage.web");
  assert.equal(decoded.payload.aud, "https://appleid.apple.com");
  assert.equal(decoded.payload.exp - decoded.payload.iat, 300);
  assert.doesNotThrow(() =>
    jwt.verify(client_secret, ec_keys.publicKey, {
      algorithms: ["ES256"],
      audience: "https://appleid.apple.com",
      issuer: "TEAMID1234",
      subject: "com.hspark.shiftmate.stage.web",
    }),
  );
});

test("Apple refresh token은 AES-256-GCM AAD로 암복호화하고 다른 key/AAD를 거부한다", () => {
  const service = new AppleService({
    random_bytes: (size) => Buffer.alloc(size, 3),
  });
  const encrypted = service.encryptRefreshToken(
    "apple-refresh-token",
    "apple-subject",
    "com.hspark.shiftmate",
  );
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.auth_tag.length, 16);
  assert.equal(
    service.decryptRefreshToken(
      encrypted,
      "apple-subject",
      "com.hspark.shiftmate",
    ),
    "apple-refresh-token",
  );
  assert.throws(
    () =>
      service.decryptRefreshToken(
        encrypted,
        "different-subject",
        "com.hspark.shiftmate",
      ),
    /APPLE_TOKEN_DECRYPT_FAILED/,
  );

  const original_key = process.env.APPLE_TOKEN_ENCRYPTION_KEY;
  process.env.APPLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  assert.throws(
    () =>
      service.decryptRefreshToken(
        encrypted,
        "apple-subject",
        "com.hspark.shiftmate",
      ),
    /APPLE_TOKEN_DECRYPT_FAILED/,
  );
  process.env.APPLE_TOKEN_ENCRYPTION_KEY = original_key;
});

test("Apple id_token은 RS256/JWKS와 issuer, audience, nonce, verified email을 검증한다", async () => {
  const rsa_keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const public_jwk = rsa_keys.publicKey.export({ format: "jwk" });
  public_jwk.kid = "apple-test-kid";
  public_jwk.alg = "RS256";
  public_jwk.use = "sig";
  let jwks_request_count = 0;
  const service = new AppleService({
    http_client: {
      get: async () => {
        jwks_request_count += 1;
        return {
          data: { keys: [public_jwk] },
          headers: { "cache-control": "public, max-age=3600" },
        };
      },
      post: async () => {
        throw new Error("unexpected token endpoint call");
      },
    },
  });
  const identity_token = jwt.sign(
    {
      nonce: "raw-test-nonce",
      email: "Relay@PrivateRelay.AppleID.com",
      email_verified: "true",
    },
    rsa_keys.privateKey,
    {
      algorithm: "RS256",
      keyid: "apple-test-kid",
      issuer: "https://appleid.apple.com",
      audience: "com.hspark.shiftmate",
      subject: "apple-user-subject",
      expiresIn: 300,
    },
  );

  const verified = await service.verifyIdentityToken(
    identity_token,
    "com.hspark.shiftmate",
    "raw-test-nonce",
  );
  assert.deepEqual(verified, {
    subject: "apple-user-subject",
    email: "Relay@PrivateRelay.AppleID.com",
    email_verified: true,
    nonce: "raw-test-nonce",
  });
  assert.equal(jwks_request_count, 1);

  await assert.rejects(
    service.verifyIdentityToken(
      identity_token,
      "com.hspark.shiftmate",
      "wrong-nonce",
    ),
    (error) =>
      error instanceof AppleAuthError && error.code === "APPLE_INVALID_TOKEN",
  );
  assert.equal(jwks_request_count, 1);
});

test("알 수 없는 JWKS kid는 강제 갱신 후에도 없으면 공통 token 오류로 종료한다", async () => {
  const rsa_keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const different_public_jwk = rsa_keys.publicKey.export({ format: "jwk" });
  different_public_jwk.kid = "different-kid";
  different_public_jwk.alg = "RS256";
  let jwks_request_count = 0;
  const service = new AppleService({
    http_client: {
      get: async () => {
        jwks_request_count += 1;
        return {
          data: { keys: [different_public_jwk] },
          headers: { "cache-control": "max-age=3600" },
        };
      },
      post: async () => {
        throw new Error("unexpected token endpoint call");
      },
    },
  });
  const unknown_kid_token = jwt.sign(
    { nonce: "nonce" },
    rsa_keys.privateKey,
    {
      algorithm: "RS256",
      keyid: "unknown-kid",
      issuer: "https://appleid.apple.com",
      audience: "com.hspark.shiftmate",
      subject: "subject",
      expiresIn: 300,
    },
  );
  await assert.rejects(
    service.verifyIdentityToken(
      unknown_kid_token,
      "com.hspark.shiftmate",
      "nonce",
    ),
    (error) =>
      error instanceof AppleAuthError && error.code === "APPLE_INVALID_TOKEN",
  );
  assert.equal(jwks_request_count, 1);
});

test("OpenAPI와 migration은 Apple 공개 계약, hash 제약, 안전 rollback을 고정한다", () => {
  const spec = JSON.parse(
    readRepositoryFile("src/openapi/appleAuthOpenApi.json"),
  );
  assert.ok(spec.paths["/auth/apple/challenge"].post);
  assert.ok(spec.paths["/auth/apple"].post);
  assert.ok(spec.paths["/auth/apple/callback"].post);
  assert.equal(
    spec.components.schemas.AppleLoginResponse.properties.data.properties
      .expires_at.description,
    "Unix epoch milliseconds",
  );
  assert.ok(
    spec.components.schemas.AppleErrorResponse.properties.error.properties.code.enum.includes(
      "ACCOUNT_LINK_REQUIRED",
    ),
  );

  const migration = readRepositoryFile("migrations/add_apple_auth_support.sql");
  const preflight = readRepositoryFile("migrations/apple_auth_preflight.sql");
  const postflight = readRepositoryFile("migrations/apple_auth_postflight.sql");
  const rollback = readRepositoryFile(
    "migrations/rollback_apple_auth_support.sql",
  );
  assert.match(migration, /state_hash char\(64\) NOT NULL/);
  assert.match(migration, /refresh_token_ciphertext bytea NOT NULL/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(preflight, /idx_users_apple_id/);
  assert.match(postflight, /expect_apple_tables_empty/);
  assert.match(rollback, /confirm_apple_auth_support_drop/);
  assert.match(rollback, /두 테이블이 모두 0건이어야 합니다/);
});

test("Apple 환경변수 예시는 기능 플래그 false와 비밀키 파일 경로만 제공한다", () => {
  const environment_example = readRepositoryFile(".env.example");
  assert.match(environment_example, /^APPLE_AUTH_ENABLED=false$/m);
  assert.match(environment_example, /^APPLE_PRIVATE_KEY_PATH=$/m);
  assert.doesNotMatch(environment_example, /BEGIN PRIVATE KEY/);
});

test("기능 플래그가 false이면 공개 challenge endpoint는 503 공통 오류를 반환한다", async () => {
  process.env.APPLE_AUTH_ENABLED = "false";
  const {
    createAppleChallenge,
  } = require("../dist/controllers/authController.js");
  let response_status = 200;
  let response_body;
  const response = {
    status(status_code) {
      response_status = status_code;
      return this;
    },
    json(body) {
      response_body = body;
      return this;
    },
  };
  try {
    await createAppleChallenge(
      {
        body: { platform: "ios" },
        request_id: "00000000-0000-4000-8000-000000000001",
      },
      response,
    );
    assert.equal(response_status, 503);
    assert.equal(response_body.success, false);
    assert.equal(response_body.error.code, "APPLE_AUTH_DISABLED");
    assert.equal(
      response_body.request_id,
      "00000000-0000-4000-8000-000000000001",
    );
  } finally {
    process.env.APPLE_AUTH_ENABLED = "true";
  }
});
