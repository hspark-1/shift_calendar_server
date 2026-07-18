import dotenv from "dotenv";

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
}
