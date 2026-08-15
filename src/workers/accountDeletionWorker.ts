import crypto from "crypto";
import { QueryTypes } from "sequelize";
import {
  checkDatabaseConnection,
  connectDatabase,
  disconnectDatabase,
  sequelize,
} from "../config/database";
import {
  getPositiveIntegerEnvironmentVariable,
  validateAppleAuthEnvironment,
  validateEnvironment,
} from "../config/environment";
import {
  checkRedisConnection,
  disconnectRedis,
} from "../config/redis";
import { isAccountDeletionWorkerEnabled } from "../config/accountDeletion";
import {
  AccountDeletionProviderTask,
  AccountDeletionRequest,
} from "../models";
import {
  cleanupCompletedAccountDeletionRequests,
  purgeAccountData,
} from "../services/accountDeletionService";
import {
  AccountDeletionProviderError,
  accountDeletionProviderService,
} from "../services/accountDeletionProviderService";
import { purgeDeletedUserWorkShiftCache } from "../services/workShiftMonthCacheService";
import { logError } from "../utils/logger";

interface ClaimedDeletionRequest {
  deletion_request_id: string;
}

let is_stopping = false;

export function calculateAccountDeletionRetryDelayMs(
  attempt_count: number,
  random_value = Math.random(),
): number {
  const base_delay_ms = Math.min(
    60 * 60 * 1000,
    10 * 1000 * 2 ** Math.max(0, attempt_count - 1),
  );
  return Math.round(
    base_delay_ms * (0.8 + Math.min(1, Math.max(0, random_value)) * 0.4),
  );
}

async function claimRequests(): Promise<ClaimedDeletionRequest[]> {
  const claim_token = crypto.randomUUID();
  const batch_size = getPositiveIntegerEnvironmentVariable(
    "ACCOUNT_DELETION_BATCH_SIZE",
    10,
  );
  const lease_seconds = getPositiveIntegerEnvironmentVariable(
    "ACCOUNT_DELETION_LEASE_SECONDS",
    120,
  );
  const max_attempts = getPositiveIntegerEnvironmentVariable(
    "ACCOUNT_DELETION_MAX_ATTEMPTS",
    12,
  );
  return sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `
        UPDATE account_deletion_requests
        SET status = 'FAILED',
            claimed_at = NULL,
            claim_token = NULL,
            last_error_code = 'ACCOUNT_DELETION_MAX_ATTEMPTS_EXCEEDED'
        WHERE status IN ('PENDING', 'RETRY', 'PROCESSING', 'CACHE_PURGE_PENDING')
          AND attempt_count >= :max_attempts
          AND (
            claimed_at IS NULL
            OR claimed_at < now() - make_interval(secs => :lease_seconds)
          )
      `,
      { replacements: { max_attempts, lease_seconds }, transaction },
    );
    return sequelize.query<ClaimedDeletionRequest>(
      `
        UPDATE account_deletion_requests
        SET status = 'PROCESSING',
            claimed_at = now(),
            claim_token = :claim_token,
            attempt_count = attempt_count + 1,
            last_error_code = NULL
        WHERE deletion_request_id IN (
          SELECT deletion_request_id
          FROM account_deletion_requests
          WHERE status IN ('PENDING', 'RETRY', 'PROCESSING', 'CACHE_PURGE_PENDING')
            AND available_at <= now()
            AND attempt_count < :max_attempts
            AND (
              claimed_at IS NULL
              OR claimed_at < now() - make_interval(secs => :lease_seconds)
            )
          ORDER BY requested_at
          FOR UPDATE SKIP LOCKED
          LIMIT :batch_size
        )
        RETURNING deletion_request_id
      `,
      {
        replacements: {
          claim_token,
          batch_size,
          lease_seconds,
          max_attempts,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
  });
}

async function processProviderTasks(
  request: AccountDeletionRequest,
): Promise<"COMPLETED" | "RETRY" | "FAILED"> {
  const user_id = request.user_id;
  if (!user_id) return "COMPLETED";
  const tasks = await AccountDeletionProviderTask.findAll({
    where: { deletion_request_id: request.deletion_request_id },
    order: [["provider", "ASC"]],
  });

  for (const task of tasks) {
    if (task.status === "COMPLETED") continue;
    task.status = "PROCESSING";
    task.attempt_count += 1;
    task.last_error_code = null;
    task.updated_at = new Date();
    await task.save();
    try {
      if (task.provider === "APPLE") {
        await accountDeletionProviderService.revokeApple(user_id);
      } else {
        await accountDeletionProviderService.unlinkKakao(user_id);
      }
      task.status = "COMPLETED";
      task.completed_at = new Date();
      task.updated_at = new Date();
      await task.save();
    } catch (error) {
      const provider_error =
        error instanceof AccountDeletionProviderError ? error : null;
      const retryable = provider_error ? provider_error.retryable : true;
      task.status = retryable ? "RETRY" : "FAILED";
      task.available_at = new Date(
        Date.now() + calculateAccountDeletionRetryDelayMs(task.attempt_count),
      );
      task.last_error_code =
        provider_error?.code ?? "PROVIDER_TASK_UNKNOWN_ERROR";
      task.updated_at = new Date();
      await task.save();
      return retryable ? "RETRY" : "FAILED";
    }
  }
  return "COMPLETED";
}

async function releaseForRetry(
  request: AccountDeletionRequest,
  error_code: string,
): Promise<void> {
  request.status = "RETRY";
  request.available_at = new Date(
    Date.now() + calculateAccountDeletionRetryDelayMs(request.attempt_count),
  );
  request.claimed_at = null;
  request.claim_token = null;
  request.last_error_code = error_code;
  await request.save();
}

async function markFailed(
  request: AccountDeletionRequest,
  error_code: string,
): Promise<void> {
  request.status = "FAILED";
  request.claimed_at = null;
  request.claim_token = null;
  request.last_error_code = error_code;
  await request.save();
}

export async function processAccountDeletionRequest(
  deletion_request_id: string,
): Promise<void> {
  let request = await AccountDeletionRequest.findByPk(deletion_request_id);
  if (!request || request.status === "COMPLETED") return;

  if (!request.db_purged_at) {
    const provider_result = await processProviderTasks(request);
    if (provider_result === "RETRY") {
      await releaseForRetry(request, "PROVIDER_RETRY_PENDING");
      return;
    }
    if (provider_result === "FAILED") {
      await markFailed(request, "PROVIDER_TASK_FAILED");
      return;
    }
    try {
      await purgeAccountData(request);
    } catch (error) {
      await releaseForRetry(request, "ACCOUNT_DB_PURGE_FAILED");
      throw error;
    }
    request = (await AccountDeletionRequest.findByPk(deletion_request_id))!;
  }

  if (!request.user_id) {
    await markFailed(request, "ACCOUNT_CACHE_PURGE_CONTEXT_MISSING");
    return;
  }
  const cache_purged = await purgeDeletedUserWorkShiftCache(
    request.user_id,
    request.cache_year_months,
  );
  if (!cache_purged) {
    request.status = "CACHE_PURGE_PENDING";
    request.available_at = new Date(
      Date.now() + calculateAccountDeletionRetryDelayMs(request.attempt_count),
    );
    request.claimed_at = null;
    request.claim_token = null;
    request.last_error_code = "ACCOUNT_CACHE_PURGE_FAILED";
    await request.save();
    return;
  }

  request.status = "COMPLETED";
  request.cache_purged_at = new Date();
  request.completed_at = new Date();
  request.user_id = null;
  request.cache_year_months = [];
  request.claimed_at = null;
  request.claim_token = null;
  request.last_error_code = null;
  await request.save();
}

export async function processAccountDeletionBatch(): Promise<number> {
  const requests = await claimRequests();
  for (const request of requests) {
    try {
      await processAccountDeletionRequest(request.deletion_request_id);
    } catch (error) {
      logError("account_deletion_request_failed", error);
    }
  }
  return requests.length;
}

async function runHealthCheck(): Promise<void> {
  validateEnvironment();
  validateAppleAuthEnvironment();
  try {
    await connectDatabase();
    await checkDatabaseConnection();
    if (isAccountDeletionWorkerEnabled()) {
      await Promise.all([
        sequelize.query(
          "SELECT account_status, deletion_requested_at FROM users LIMIT 0",
          { type: QueryTypes.SELECT },
        ),
        AccountDeletionRequest.count(),
        AccountDeletionProviderTask.count(),
      ]);
    }
    if (process.env.REDIS_URL?.trim()) {
      const status = await checkRedisConnection({ force_connection: true });
      if (status !== "ready") throw new Error("REDIS_NOT_READY");
    }
  } finally {
    await disconnectRedis().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (is_stopping) return;
  is_stopping = true;
  console.log(JSON.stringify({ context: "account_deletion_worker_stopping", signal }));
  await disconnectRedis().catch(() => undefined);
  await disconnectDatabase().catch(() => undefined);
}

async function runWorker(): Promise<void> {
  validateEnvironment();
  validateAppleAuthEnvironment();
  await connectDatabase();
  const poll_ms = getPositiveIntegerEnvironmentVariable(
    "ACCOUNT_DELETION_POLL_MS",
    1000,
  );
  let last_cleanup_at = 0;
  console.log(JSON.stringify({ context: "account_deletion_worker_started" }));
  while (!is_stopping) {
    try {
      if (!isAccountDeletionWorkerEnabled()) {
        await new Promise((resolve) => setTimeout(resolve, poll_ms));
        continue;
      }
      const processed_count = await processAccountDeletionBatch();
      if (Date.now() - last_cleanup_at >= 24 * 60 * 60 * 1000) {
        await cleanupCompletedAccountDeletionRequests();
        last_cleanup_at = Date.now();
      }
      if (processed_count === 0) {
        await new Promise((resolve) => setTimeout(resolve, poll_ms));
      }
    } catch (error) {
      logError("account_deletion_worker_batch_failed", error);
      await new Promise((resolve) => setTimeout(resolve, poll_ms));
    }
  }
}

if (require.main === module) {
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  if (process.argv.includes("--healthcheck")) {
    runHealthCheck().catch((error) => {
      logError("account_deletion_worker_healthcheck_failed", error);
      process.exitCode = 1;
    });
  } else {
    runWorker()
      .then(() => shutdown("completed"))
      .catch(async (error) => {
        logError("account_deletion_worker_failed", error);
        await shutdown("failed");
        process.exitCode = 1;
      });
  }
}
