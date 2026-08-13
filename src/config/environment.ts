import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const required_environment_variables = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
] as const;

export function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`필수 환경변수 ${name}이(가) 설정되지 않았습니다.`);
  }
  return value;
}

export function getPositiveIntegerEnvironmentVariable(
  name: string,
  default_value: number,
  options?: { allow_zero?: boolean }
): number {
  const raw_value = process.env[name];
  if (raw_value === undefined || raw_value.trim() === "") {
    return default_value;
  }

  const parsed_value = Number(raw_value);
  const minimum_value = options?.allow_zero ? 0 : 1;
  if (!Number.isInteger(parsed_value) || parsed_value < minimum_value) {
    throw new Error(
      `${name}은(는) ${minimum_value} 이상의 정수여야 합니다.`
    );
  }

  return parsed_value;
}

export function getBooleanEnvironmentVariable(
  name: string,
  default_value: boolean,
): boolean {
  const raw_value = process.env[name];
  if (raw_value === undefined || raw_value.trim() === "") {
    return default_value;
  }

  if (raw_value === "true") return true;
  if (raw_value === "false") return false;
  throw new Error(`${name}은(는) true 또는 false여야 합니다.`);
}

export function getAppleTokenEncryptionKey(): Buffer {
  const encoded_key = getRequiredEnvironmentVariable(
    "APPLE_TOKEN_ENCRYPTION_KEY",
  );
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded_key)) {
    throw new Error("APPLE_TOKEN_ENCRYPTION_KEY는 유효한 base64여야 합니다.");
  }

  const decoded_key = Buffer.from(encoded_key, "base64");
  const normalized_input = encoded_key.replace(/=+$/, "");
  const normalized_output = decoded_key.toString("base64").replace(/=+$/, "");
  if (decoded_key.length !== 32 || normalized_input !== normalized_output) {
    throw new Error(
      "APPLE_TOKEN_ENCRYPTION_KEY는 base64 decode 결과가 정확히 32바이트여야 합니다.",
    );
  }
  return decoded_key;
}

export function validateAppleAuthEnvironment(): void {
  if (!getBooleanEnvironmentVariable("APPLE_AUTH_ENABLED", false)) return;

  const team_id = getRequiredEnvironmentVariable("APPLE_TEAM_ID");
  const key_id = getRequiredEnvironmentVariable("APPLE_KEY_ID");
  const ios_client_id = getRequiredEnvironmentVariable("APPLE_IOS_CLIENT_ID");
  getRequiredEnvironmentVariable("APPLE_SERVICE_ID");
  const redirect_uri = getRequiredEnvironmentVariable("APPLE_REDIRECT_URI");
  const private_key_path = getRequiredEnvironmentVariable(
    "APPLE_PRIVATE_KEY_PATH",
  );

  if (!/^[A-Z0-9]{10}$/.test(team_id)) {
    throw new Error("APPLE_TEAM_ID는 10자의 영문 대문자/숫자여야 합니다.");
  }
  if (!/^[A-Z0-9]{10}$/.test(key_id)) {
    throw new Error("APPLE_KEY_ID는 10자의 영문 대문자/숫자여야 합니다.");
  }
  if (ios_client_id !== "com.hspark.shiftmate") {
    throw new Error(
      "APPLE_IOS_CLIENT_ID는 com.hspark.shiftmate여야 합니다.",
    );
  }

  let parsed_redirect_uri: URL;
  try {
    parsed_redirect_uri = new URL(redirect_uri);
  } catch {
    throw new Error("APPLE_REDIRECT_URI는 유효한 HTTPS URL이어야 합니다.");
  }
  if (
    parsed_redirect_uri.protocol !== "https:" ||
    parsed_redirect_uri.pathname !== "/api/v1/auth/apple/callback" ||
    parsed_redirect_uri.search !== "" ||
    parsed_redirect_uri.hash !== "" ||
    parsed_redirect_uri.hostname === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed_redirect_uri.hostname)
  ) {
    throw new Error(
      "APPLE_REDIRECT_URI는 도메인 기반 HTTPS /api/v1/auth/apple/callback URL이어야 합니다.",
    );
  }

  try {
    fs.accessSync(private_key_path, fs.constants.R_OK);
  } catch {
    throw new Error("APPLE_PRIVATE_KEY_PATH 파일을 읽을 수 없습니다.");
  }
  getAppleTokenEncryptionKey();
}

export function validateGoogleAuthEnvironment(): void {
  if (!getBooleanEnvironmentVariable("GOOGLE_AUTH_ENABLED", false)) return;

  const server_client_id = getRequiredEnvironmentVariable(
    "GOOGLE_SERVER_CLIENT_ID",
  );
  if (
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(server_client_id)
  ) {
    throw new Error(
      "GOOGLE_SERVER_CLIENT_ID는 Web application OAuth client ID 형식이어야 합니다.",
    );
  }
}

export function validateEnvironment(): void {
  for (const variable_name of required_environment_variables) {
    getRequiredEnvironmentVariable(variable_name);
  }

  const node_env = process.env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(node_env)) {
    throw new Error(
      "NODE_ENV는 development, test, production 중 하나여야 합니다."
    );
  }

  const jwt_secret = getRequiredEnvironmentVariable("JWT_SECRET");
  const jwt_refresh_secret =
    getRequiredEnvironmentVariable("JWT_REFRESH_SECRET");
  if (jwt_secret === jwt_refresh_secret) {
    throw new Error(
      "JWT_SECRET과 JWT_REFRESH_SECRET은 서로 다른 값이어야 합니다."
    );
  }

  if (process.env.DB_SYNC === "true") {
    throw new Error(
      "런타임 DB 동기화는 지원하지 않습니다. DB 변경은 서버 실행 전에 개발자가 수동 적용해야 합니다."
    );
  }

  getPositiveIntegerEnvironmentVariable("PORT", 3000);
  getPositiveIntegerEnvironmentVariable("DB_POOL_MAX", 10);
  getPositiveIntegerEnvironmentVariable("DB_POOL_MIN", 0, {
    allow_zero: true,
  });
  getPositiveIntegerEnvironmentVariable("DB_POOL_ACQUIRE_MS", 30000);
  getPositiveIntegerEnvironmentVariable("DB_POOL_IDLE_MS", 10000);
  getPositiveIntegerEnvironmentVariable("TRUST_PROXY_HOPS", 0, {
    allow_zero: true,
  });
  getPositiveIntegerEnvironmentVariable("SHUTDOWN_TIMEOUT_MS", 10000);
  getPositiveIntegerEnvironmentVariable("AUTH_RATE_LIMIT_WINDOW_MS", 60000);
  getPositiveIntegerEnvironmentVariable("AUTH_RATE_LIMIT_MAX", 10);
  getPositiveIntegerEnvironmentVariable("WORK_SHIFT_CACHE_TTL_SECONDS", 86400);
  getPositiveIntegerEnvironmentVariable("WORK_SHIFT_CACHE_TTL_JITTER_SECONDS", 3600, {
    allow_zero: true,
  });
  getPositiveIntegerEnvironmentVariable("WORK_SHIFT_CACHE_LOCK_MS", 5000);
  getPositiveIntegerEnvironmentVariable("WORK_SHIFT_CACHE_WAIT_MS", 500);
  getPositiveIntegerEnvironmentVariable("REDIS_CONNECT_TIMEOUT_MS", 500);
  getPositiveIntegerEnvironmentVariable("REDIS_COMMAND_TIMEOUT_MS", 100);
  getPositiveIntegerEnvironmentVariable("CACHE_OUTBOX_POLL_MS", 1000);
  getPositiveIntegerEnvironmentVariable("CACHE_OUTBOX_BATCH_SIZE", 100);
  getPositiveIntegerEnvironmentVariable("GROUP_MEMBER_LIMIT", 20);
  getPositiveIntegerEnvironmentVariable("GROUP_INVITATION_TTL_DAYS", 7);
  getPositiveIntegerEnvironmentVariable("GROUP_CALENDAR_MAX_RANGE_DAYS", 100);
  getPositiveIntegerEnvironmentVariable("PUSH_JOB_POLL_MS", 1000);
  getPositiveIntegerEnvironmentVariable("PUSH_JOB_BATCH_SIZE", 20);
  getPositiveIntegerEnvironmentVariable("PUSH_JOB_LEASE_SECONDS", 120);
  getPositiveIntegerEnvironmentVariable("PUSH_MAX_ATTEMPTS", 6);
  getPositiveIntegerEnvironmentVariable("PUSH_JOB_TTL_SECONDS", 3600);
  getPositiveIntegerEnvironmentVariable("PUSH_TERMINAL_RETENTION_DAYS", 30);
  const apple_challenge_ttl_seconds = getPositiveIntegerEnvironmentVariable(
    "APPLE_CHALLENGE_TTL_SECONDS",
    300,
  );
  if (
    apple_challenge_ttl_seconds < 60 ||
    apple_challenge_ttl_seconds > 600
  ) {
    throw new Error("APPLE_CHALLENGE_TTL_SECONDS는 60~600초여야 합니다.");
  }
  const apple_jwks_cache_seconds = getPositiveIntegerEnvironmentVariable(
    "APPLE_JWKS_CACHE_SECONDS",
    21600,
  );
  if (apple_jwks_cache_seconds < 60 || apple_jwks_cache_seconds > 86400) {
    throw new Error("APPLE_JWKS_CACHE_SECONDS는 60~86400초여야 합니다.");
  }
  getBooleanEnvironmentVariable("WORK_SHIFT_CACHE_ENABLED", false);
  getBooleanEnvironmentVariable("PUSH_JOB_ENQUEUE_ENABLED", false);
  getBooleanEnvironmentVariable("PUSH_WORKER_ENABLED", false);
  getBooleanEnvironmentVariable("API_DOCS_ENABLED", false);
  getBooleanEnvironmentVariable("APPLE_AUTH_ENABLED", false);
  getBooleanEnvironmentVariable("GOOGLE_AUTH_ENABLED", false);
  validateGoogleAuthEnvironment();

  const push_app_environment = process.env.PUSH_APP_ENVIRONMENT?.trim();
  if (
    push_app_environment !== undefined &&
    !["STAGE", "PROD"].includes(push_app_environment)
  ) {
    throw new Error("PUSH_APP_ENVIRONMENT는 STAGE 또는 PROD여야 합니다.");
  }

  if (getBooleanEnvironmentVariable("PUSH_WORKER_ENABLED", false)) {
    getRequiredEnvironmentVariable("FIREBASE_PROJECT_ID");
    getRequiredEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS");
  }

  const db_pool_max = getPositiveIntegerEnvironmentVariable("DB_POOL_MAX", 10);
  const db_pool_min = getPositiveIntegerEnvironmentVariable(
    "DB_POOL_MIN",
    0,
    { allow_zero: true }
  );
  if (db_pool_min > db_pool_max) {
    throw new Error("DB_POOL_MIN은 DB_POOL_MAX보다 클 수 없습니다.");
  }

  const db_ssl = process.env.DB_SSL;
  if (db_ssl !== undefined && !["true", "false"].includes(db_ssl)) {
    throw new Error("DB_SSL은 true 또는 false여야 합니다.");
  }

  const request_body_limit = process.env.REQUEST_BODY_LIMIT;
  if (
    request_body_limit !== undefined &&
    !/^[1-9][0-9]*(b|kb|mb)$/i.test(request_body_limit)
  ) {
    throw new Error(
      "REQUEST_BODY_LIMIT은 100kb, 1mb와 같은 양의 크기 형식이어야 합니다."
    );
  }

  if (getBooleanEnvironmentVariable("WORK_SHIFT_CACHE_ENABLED", false)) {
    getRequiredEnvironmentVariable("REDIS_URL");
    getRequiredEnvironmentVariable("CACHE_KEY_PREFIX");
  }
}
