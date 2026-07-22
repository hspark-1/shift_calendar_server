import { createClient, RedisClientType } from "redis";
import {
  getBooleanEnvironmentVariable,
  getPositiveIntegerEnvironmentVariable,
  getRequiredEnvironmentVariable,
} from "./environment";

export type CacheDependencyStatus = "ready" | "degraded" | "disabled";

let redis_client: RedisClientType | null = null;
let redis_connect_promise: Promise<RedisClientType | null> | null = null;
let cache_status: CacheDependencyStatus = "disabled";

export function isWorkShiftCacheEnabled(): boolean {
  return getBooleanEnvironmentVariable("WORK_SHIFT_CACHE_ENABLED", false);
}

export function getCacheDependencyStatus(): CacheDependencyStatus {
  return isWorkShiftCacheEnabled() ? cache_status : "disabled";
}

export async function withRedisCommandTimeout<T>(
  operation: Promise<T>,
): Promise<T> {
  const timeout_ms = getPositiveIntegerEnvironmentVariable(
    "REDIS_COMMAND_TIMEOUT_MS",
    100,
  );

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("REDIS_COMMAND_TIMEOUT")),
          timeout_ms,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getRedisClient(options?: {
  force_connection?: boolean;
}): Promise<RedisClientType | null> {
  if (!isWorkShiftCacheEnabled() && !options?.force_connection) {
    cache_status = "disabled";
    return null;
  }

  if (redis_client?.isReady) {
    cache_status = "ready";
    return redis_client;
  }

  if (redis_connect_promise) return redis_connect_promise;

  redis_connect_promise = (async () => {
    try {
      if (!redis_client) {
        const connect_timeout_ms = getPositiveIntegerEnvironmentVariable(
          "REDIS_CONNECT_TIMEOUT_MS",
          500,
        );
        redis_client = createClient({
          url: getRequiredEnvironmentVariable("REDIS_URL"),
          disableOfflineQueue: true,
          socket: {
            connectTimeout: connect_timeout_ms,
            reconnectStrategy: false,
          },
        });
        redis_client.on("error", () => {
          cache_status = "degraded";
        });
      }

      if (!redis_client.isOpen) await redis_client.connect();
      await withRedisCommandTimeout(redis_client.ping());
      cache_status = "ready";
      return redis_client;
    } catch {
      cache_status = "degraded";
      if (redis_client?.isOpen) {
        await redis_client.close().catch(() => undefined);
      }
      redis_client = null;
      return null;
    } finally {
      redis_connect_promise = null;
    }
  })();

  return redis_connect_promise;
}

export async function checkRedisConnection(options?: {
  force_connection?: boolean;
}): Promise<CacheDependencyStatus> {
  const client = await getRedisClient(options);
  if (!client) return getCacheDependencyStatus();

  try {
    await withRedisCommandTimeout(client.ping());
    cache_status = "ready";
  } catch {
    cache_status = "degraded";
  }
  return cache_status;
}

export async function disconnectRedis(): Promise<void> {
  if (redis_client?.isOpen) {
    await redis_client.close();
  }
  redis_client = null;
  redis_connect_promise = null;
  cache_status = isWorkShiftCacheEnabled() ? "degraded" : "disabled";
}
