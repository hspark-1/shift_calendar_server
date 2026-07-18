import { NextFunction, Request, Response } from "express";
import { getPositiveIntegerEnvironmentVariable } from "../config/environment";

interface RateLimitRecord {
  count: number;
  reset_at: number;
}

const auth_rate_limit_window_ms = getPositiveIntegerEnvironmentVariable(
  "AUTH_RATE_LIMIT_WINDOW_MS",
  60000
);
const auth_rate_limit_max = getPositiveIntegerEnvironmentVariable(
  "AUTH_RATE_LIMIT_MAX",
  10
);
const max_tracked_clients = 10000;
const rate_limit_records = new Map<string, RateLimitRecord>();

function removeExpiredRecords(now: number): void {
  for (const [key, record] of rate_limit_records) {
    if (record.reset_at <= now) {
      rate_limit_records.delete(key);
    }
  }

  while (rate_limit_records.size >= max_tracked_clients) {
    const oldest_key = rate_limit_records.keys().next().value;
    if (typeof oldest_key !== "string") break;
    rate_limit_records.delete(oldest_key);
  }
}

export function authRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const now = Date.now();
  const client_key = req.ip || req.socket.remoteAddress || "unknown";
  let record = rate_limit_records.get(client_key);

  if (!record || record.reset_at <= now) {
    if (rate_limit_records.size >= max_tracked_clients) {
      removeExpiredRecords(now);
    }
    record = {
      count: 0,
      reset_at: now + auth_rate_limit_window_ms,
    };
    rate_limit_records.set(client_key, record);
  }

  record.count += 1;
  const remaining = Math.max(auth_rate_limit_max - record.count, 0);
  const retry_after_seconds = Math.max(
    Math.ceil((record.reset_at - now) / 1000),
    1
  );

  res.setHeader("RateLimit-Limit", auth_rate_limit_max);
  res.setHeader("RateLimit-Remaining", remaining);
  res.setHeader("RateLimit-Reset", retry_after_seconds);

  if (record.count > auth_rate_limit_max) {
    res.setHeader("Retry-After", retry_after_seconds);
    res.status(429).json({
      success: false,
      message: "인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      error: {
        code: "AUTH_RATE_LIMIT_EXCEEDED",
        message: "인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      },
      request_id: req.request_id,
    });
    return;
  }

  next();
}
