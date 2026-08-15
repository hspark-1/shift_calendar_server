import crypto from "crypto";
import { Op, QueryTypes } from "sequelize";
import {
  checkDatabaseConnection,
  connectDatabase,
  disconnectDatabase,
  sequelize,
} from "../config/database";
import {
  getPositiveIntegerEnvironmentVariable,
  validateEnvironment,
  validatePushWorkerEnvironment,
} from "../config/environment";
import {
  getPushAppEnvironment,
  isPushWorkerEnabled,
} from "../config/push";
import { PushDelivery, PushJob, UserDevice } from "../models";
import { createFirebasePushProvider } from "../services/firebasePushProvider";
import { disableDeviceTarget } from "../services/deviceService";
import {
  PushMessage,
  PushProvider,
  PushSendResult,
} from "../services/pushProvider";
import { logError } from "../utils/logger";

interface ClaimedPushJob {
  push_job_id: string;
  notification_id: string;
  receiver_user_id: string;
  title: string;
  body: string | null;
  data_payload: Record<string, string>;
  attempt_count: number;
  expires_at: Date;
  locked_by: string;
}

interface PreparedDelivery {
  job: ClaimedPushJob;
  delivery_id: string;
  device_id: string;
  message: PushMessage;
  target_hash: string;
}

const permanent_target_error_codes = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
const retryable_error_codes = new Set([
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
  "app/network-error",
  "UNKNOWN_ERROR",
]);

let is_stopping = false;

export function isPermanentTargetError(error_code: string): boolean {
  return (
    permanent_target_error_codes.has(error_code) ||
    error_code === "messaging/invalid-argument"
  );
}

export function calculateRetryDelayMs(
  attempt_count: number,
  retry_after_seconds?: number,
  random_value = Math.random(),
): number {
  if (retry_after_seconds && retry_after_seconds > 0) {
    return Math.min(15 * 60 * 1000, retry_after_seconds * 1000);
  }
  const base_delay_ms = Math.min(
    15 * 60 * 1000,
    10 * 1000 * 2 ** Math.max(0, attempt_count - 1),
  );
  const jitter_multiplier = 0.8 + Math.min(1, Math.max(0, random_value)) * 0.4;
  return Math.round(base_delay_ms * jitter_multiplier);
}

async function expireAndCancelJobs(): Promise<void> {
  const max_attempts = getPositiveIntegerEnvironmentVariable(
    "PUSH_MAX_ATTEMPTS",
    6,
  );
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `
        UPDATE push_deliveries AS delivery
        SET status = CASE
              WHEN job.cancel_requested_at IS NOT NULL THEN 'SKIPPED'
              ELSE 'FAILED'
            END,
            error_code = CASE
              WHEN job.cancel_requested_at IS NOT NULL THEN 'JOB_CANCELED'
              WHEN job.expires_at <= now() THEN 'JOB_EXPIRED'
              ELSE 'MAX_ATTEMPTS_EXCEEDED'
            END,
            next_retry_at = NULL,
            updated_at = now()
        FROM push_jobs AS job
        WHERE delivery.push_job_id = job.push_job_id
          AND delivery.status IN ('PENDING', 'SENDING', 'RETRY')
          AND job.status IN ('PENDING', 'RETRY', 'PROCESSING')
          AND (job.status <> 'PROCESSING' OR job.lease_until <= now())
          AND (
            job.cancel_requested_at IS NOT NULL
            OR job.expires_at <= now()
            OR job.attempt_count >= :max_attempts
          )
      `,
      { replacements: { max_attempts }, transaction },
    );
    await sequelize.query(
      `
        UPDATE push_jobs
        SET status = CASE
              WHEN cancel_requested_at IS NOT NULL THEN 'CANCELED'
              WHEN expires_at <= now() THEN 'EXPIRED'
              ELSE 'FAILED'
            END,
            completed_at = now(),
            locked_by = NULL,
            lease_until = NULL,
            updated_at = now(),
            last_error_code = CASE
              WHEN cancel_requested_at IS NOT NULL THEN last_error_code
              WHEN expires_at <= now() THEN 'JOB_EXPIRED'
              ELSE 'MAX_ATTEMPTS_EXCEEDED'
            END
        WHERE status IN ('PENDING', 'RETRY', 'PROCESSING')
          AND (status <> 'PROCESSING' OR lease_until <= now())
          AND (
            cancel_requested_at IS NOT NULL
            OR expires_at <= now()
            OR attempt_count >= :max_attempts
          )
      `,
      { replacements: { max_attempts }, transaction },
    );
  });
}

async function claimJobs(): Promise<ClaimedPushJob[]> {
  const batch_size = getPositiveIntegerEnvironmentVariable(
    "PUSH_JOB_BATCH_SIZE",
    20,
  );
  const lease_seconds = getPositiveIntegerEnvironmentVariable(
    "PUSH_JOB_LEASE_SECONDS",
    120,
  );
  const locked_by = process.env.INSTANCE_NAME?.trim() || crypto.randomUUID();
  const max_attempts = getPositiveIntegerEnvironmentVariable(
    "PUSH_MAX_ATTEMPTS",
    6,
  );

  await expireAndCancelJobs();
  return sequelize.transaction(async (transaction) =>
    sequelize.query<ClaimedPushJob>(
      `
        UPDATE push_jobs
        SET status = 'PROCESSING',
            locked_by = :locked_by,
            lease_until = now() + make_interval(secs => :lease_seconds),
            updated_at = now()
        WHERE push_job_id IN (
          SELECT push_job_id
          FROM push_jobs
          WHERE (
              (status IN ('PENDING', 'RETRY') AND available_at <= now())
              OR (status = 'PROCESSING' AND lease_until <= now())
            )
            AND cancel_requested_at IS NULL
            AND expires_at > now()
            AND attempt_count < :max_attempts
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT :batch_size
        )
        RETURNING push_job_id, notification_id, receiver_user_id, title, body,
                  data_payload, attempt_count, expires_at, locked_by
      `,
      {
        replacements: {
          locked_by,
          lease_seconds,
          max_attempts,
          batch_size,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    ),
  );
}

async function finishWithoutTarget(
  job: ClaimedPushJob,
  delivery?: PushDelivery,
  error_code = "NO_ACTIVE_DEVICE",
): Promise<void> {
  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    if (delivery) {
      await delivery.update(
        {
          status: "SKIPPED",
          error_code,
          next_retry_at: null,
          updated_at: now,
        },
        { transaction },
      );
    }
    await PushJob.update(
      {
        status: "NO_TARGET",
        completed_at: now,
        last_error_code: error_code,
        locked_by: null,
        lease_until: null,
        updated_at: now,
      },
      {
        where: {
          push_job_id: job.push_job_id,
          status: "PROCESSING",
          locked_by: job.locked_by,
        },
        transaction,
      },
    );
  });
}

async function prepareDelivery(
  claimed_job: ClaimedPushJob,
): Promise<PreparedDelivery | null> {
  const result = await sequelize.transaction(async (transaction) => {
    const job = await PushJob.findByPk(claimed_job.push_job_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (
      !job ||
      job.status !== "PROCESSING" ||
      job.locked_by !== claimed_job.locked_by
    ) {
      return { kind: "IGNORED" as const };
    }
    const now = new Date();
    if (job.cancel_requested_at) {
      await job.update(
        {
          status: "CANCELED",
          completed_at: now,
          locked_by: null,
          lease_until: null,
          updated_at: now,
        },
        { transaction },
      );
      return { kind: "IGNORED" as const };
    }
    if (job.expires_at <= now) {
      await job.update(
        {
          status: "EXPIRED",
          completed_at: now,
          last_error_code: "JOB_EXPIRED",
          locked_by: null,
          lease_until: null,
          updated_at: now,
        },
        { transaction },
      );
      return { kind: "IGNORED" as const };
    }

    let delivery = await PushDelivery.findOne({
      where: { push_job_id: job.push_job_id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!delivery) {
      const device = await UserDevice.findOne({
        where: {
          user_id: job.receiver_user_id,
          app_environment: getPushAppEnvironment(),
          provider: "FCM",
          target_type: "FCM_TOKEN",
          is_active: true,
          push_permission_enabled: true,
          provider_target: { [Op.ne]: null },
        },
        order: [
          ["last_seen_at", "DESC"],
          sequelize.literal("target_updated_at DESC NULLS LAST"),
          ["device_id", "ASC"],
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!device) return { kind: "NO_TARGET" as const };
      delivery = await PushDelivery.create(
        { push_job_id: job.push_job_id, device_id: device.device_id },
        { transaction },
      );
    }
    return { kind: "DELIVERY" as const, delivery };
  });

  if (result.kind === "IGNORED") return null;
  if (result.kind === "NO_TARGET") {
    await finishWithoutTarget(claimed_job);
    return null;
  }

  const device = await UserDevice.findByPk(result.delivery.device_id);
  if (
    !device ||
    device.user_id !== claimed_job.receiver_user_id ||
    device.app_environment !== getPushAppEnvironment() ||
    !device.is_active ||
    !device.push_permission_enabled ||
    !device.provider_target
  ) {
    await finishWithoutTarget(
      claimed_job,
      result.delivery,
      "SELECTED_DEVICE_UNAVAILABLE",
    );
    return null;
  }

  const ttl_seconds = Math.max(
    1,
    Math.ceil((new Date(claimed_job.expires_at).getTime() - Date.now()) / 1000),
  );
  const target_hash = crypto
    .createHash("sha256")
    .update(device.provider_target)
    .digest("hex");
  return {
    job: claimed_job,
    delivery_id: result.delivery.delivery_id,
    device_id: device.device_id,
    target_hash,
    message: {
      provider_target: device.provider_target,
      notification_id: claimed_job.notification_id,
      title: claimed_job.title,
      body: claimed_job.body,
      data: claimed_job.data_payload,
      ttl_seconds,
    },
  };
}

async function markSending(delivery: PreparedDelivery): Promise<boolean> {
  const now = new Date();
  return sequelize.transaction(async (transaction) => {
    const [job_count] = await PushJob.update(
      {
        attempt_count: sequelize.literal("attempt_count + 1"),
        updated_at: now,
      },
      {
        where: {
          push_job_id: delivery.job.push_job_id,
          status: "PROCESSING",
          locked_by: delivery.job.locked_by,
          cancel_requested_at: null,
        },
        transaction,
      },
    );
    if (job_count !== 1) return false;
    await PushDelivery.update(
      {
        status: "SENDING",
        attempt_count: sequelize.literal("attempt_count + 1"),
        sending_started_at: now,
        target_hash: delivery.target_hash,
        error_code: null,
        updated_at: now,
      },
      { where: { delivery_id: delivery.delivery_id }, transaction },
    );
    return true;
  });
}

async function markSuccess(
  delivery: PreparedDelivery,
  result: PushSendResult,
): Promise<void> {
  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    await PushDelivery.update(
      {
        status: "SENT",
        provider_message_id: result.provider_message_id ?? null,
        error_code: null,
        next_retry_at: null,
        sent_at: now,
        updated_at: now,
      },
      { where: { delivery_id: delivery.delivery_id }, transaction },
    );
    await PushJob.update(
      {
        status: "COMPLETED",
        completed_at: now,
        last_error_code: null,
        locked_by: null,
        lease_until: null,
        updated_at: now,
      },
      {
        where: {
          push_job_id: delivery.job.push_job_id,
          status: "PROCESSING",
          locked_by: delivery.job.locked_by,
        },
        transaction,
      },
    );
  });
}

async function markFailure(
  delivery: PreparedDelivery,
  result: PushSendResult,
): Promise<void> {
  const error_code = result.error_code ?? "UNKNOWN_ERROR";
  const now = new Date();
  const max_attempts = getPositiveIntegerEnvironmentVariable(
    "PUSH_MAX_ATTEMPTS",
    6,
  );
  const current_attempt = delivery.job.attempt_count + 1;
  const target_error = isPermanentTargetError(error_code);
  const retryable = retryable_error_codes.has(error_code);
  const can_retry =
    retryable &&
    current_attempt < max_attempts &&
    new Date(delivery.job.expires_at).getTime() > now.getTime();

  if (target_error) {
    await disableDeviceTarget(delivery.device_id, error_code);
  }

  const retry_at = can_retry
    ? new Date(
        now.getTime() +
          calculateRetryDelayMs(
            current_attempt,
            result.retry_after_seconds,
          ),
      )
    : null;
  await sequelize.transaction(async (transaction) => {
    await PushDelivery.update(
      {
        status: can_retry ? "RETRY" : "FAILED",
        error_code,
        next_retry_at: retry_at,
        updated_at: now,
      },
      { where: { delivery_id: delivery.delivery_id }, transaction },
    );
    await PushJob.update(
      {
        status: can_retry ? "RETRY" : "FAILED",
        available_at: retry_at ?? now,
        completed_at: can_retry ? null : now,
        last_error_code: error_code,
        locked_by: null,
        lease_until: null,
        updated_at: now,
      },
      {
        where: {
          push_job_id: delivery.job.push_job_id,
          status: "PROCESSING",
          locked_by: delivery.job.locked_by,
        },
        transaction,
      },
    );
  });
}

export async function processPushBatch(provider: PushProvider): Promise<number> {
  const claimed_jobs = await claimJobs();
  if (claimed_jobs.length === 0) return 0;

  const prepared_results = await Promise.all(claimed_jobs.map(prepareDelivery));
  const prepared_deliveries = prepared_results.filter(
    (delivery): delivery is PreparedDelivery => delivery !== null,
  );
  const sendable_deliveries: PreparedDelivery[] = [];
  for (const delivery of prepared_deliveries) {
    if (await markSending(delivery)) sendable_deliveries.push(delivery);
  }
  if (sendable_deliveries.length === 0) return claimed_jobs.length;

  const results = await provider.sendBatch(
    sendable_deliveries.map((delivery) => delivery.message),
  );
  if (results.length !== sendable_deliveries.length) {
    throw new Error("PUSH_PROVIDER_RESPONSE_COUNT_MISMATCH");
  }
  await Promise.all(
    results.map((result, index) =>
      result.success
        ? markSuccess(sendable_deliveries[index], result)
        : markFailure(sendable_deliveries[index], result),
    ),
  );
  return claimed_jobs.length;
}

export async function cleanupTerminalPushRecords(): Promise<void> {
  const retention_days = getPositiveIntegerEnvironmentVariable(
    "PUSH_TERMINAL_RETENTION_DAYS",
    30,
  );
  await sequelize.query(
    `
      DELETE FROM push_jobs
      WHERE status IN ('COMPLETED', 'NO_TARGET', 'FAILED', 'EXPIRED', 'CANCELED')
        AND completed_at < now() - make_interval(days => :retention_days)
    `,
    { replacements: { retention_days } },
  );
}

async function runHealthCheck(): Promise<void> {
  validateEnvironment();
  validatePushWorkerEnvironment();
  try {
    await connectDatabase();
    await checkDatabaseConnection();
    if (isPushWorkerEnabled()) {
      await createFirebasePushProvider().checkReady();
    }
  } finally {
    await disconnectDatabase().catch(() => undefined);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (is_stopping) return;
  is_stopping = true;
  console.log(JSON.stringify({ context: "push_worker_stopping", signal }));
  await disconnectDatabase().catch(() => undefined);
}

async function runWorker(): Promise<void> {
  validateEnvironment();
  validatePushWorkerEnvironment();
  await connectDatabase();
  const poll_ms = getPositiveIntegerEnvironmentVariable("PUSH_JOB_POLL_MS", 1000);
  let provider: PushProvider | null = null;
  let last_cleanup_at = 0;
  console.log(JSON.stringify({ context: "push_worker_started" }));

  while (!is_stopping) {
    try {
      if (!isPushWorkerEnabled()) {
        provider = null;
        await new Promise((resolve) => setTimeout(resolve, poll_ms));
        continue;
      }
      provider ??= createFirebasePushProvider();
      const processed_count = await processPushBatch(provider);
      if (Date.now() - last_cleanup_at >= 24 * 60 * 60 * 1000) {
        await cleanupTerminalPushRecords();
        last_cleanup_at = Date.now();
      }
      if (processed_count === 0) {
        await new Promise((resolve) => setTimeout(resolve, poll_ms));
      }
    } catch (error) {
      logError("push_worker_batch_failed", error);
      await new Promise((resolve) => setTimeout(resolve, poll_ms));
    }
  }
}

if (require.main === module) {
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  if (process.argv.includes("--healthcheck")) {
    runHealthCheck().catch((error) => {
      logError("push_worker_healthcheck_failed", error);
      process.exitCode = 1;
    });
  } else {
    runWorker()
      .then(() => shutdown("completed"))
      .catch(async (error) => {
        logError("push_worker_failed", error);
        await shutdown("failed");
        process.exitCode = 1;
      });
  }
}
