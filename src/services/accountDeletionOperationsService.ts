import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database";
import { AccountDeletionRequest, AccountDeletionProviderTask, User } from "../models";
import { assertAccountUuid, withAccountDataLock } from "../utils/accountDataLock";

export const retry_reasons = ["PROVIDER_FIXED", "STORAGE_FIXED", "REDIS_FIXED", "WORKER_RECOVERED"] as const;

export async function getDeletionMonitor(): Promise<Record<string, unknown>> {
  const [summary] = await sequelize.query<Record<string, unknown>>(`
    SELECT count(*) FILTER (WHERE status = 'FAILED')::int AS failed_count,
      count(*) FILTER (WHERE completed_at IS NULL AND requested_at <= now() - interval '7 days')::int AS overdue_count,
      count(*) FILTER (WHERE completed_at IS NULL AND requested_at <= now() - interval '30 days')::int AS resolution_overdue_count,
      count(*) FILTER (WHERE completed_at IS NULL AND requested_at <= now() - interval '24 hours')::int AS long_pending_count,
      count(*) FILTER (WHERE completed_at IS NULL)::int AS pending_count,
      COALESCE(EXTRACT(EPOCH FROM now() - min(requested_at) FILTER (WHERE completed_at IS NULL)), 0)::bigint AS oldest_pending_seconds,
      NOT EXISTS (SELECT 1 FROM privacy_worker_heartbeats WHERE worker_name = 'account-deletion'
        AND last_seen_at > now() - interval '5 minutes') AS worker_stale,
      NOT EXISTS (SELECT 1 FROM privacy_worker_heartbeats WHERE worker_name = 'push'
        AND last_seen_at > now() - interval '5 minutes') AS push_worker_stale,
      (SELECT count(*)::int FROM push_jobs WHERE status IN ('PENDING', 'PROCESSING', 'RETRY')
        AND created_at <= now() - interval '24 hours') AS push_long_pending_count
    FROM account_deletion_requests
  `, { type: QueryTypes.SELECT });
  return summary;
}

export async function listDeletionAttention(): Promise<unknown> {
  return sequelize.query(`SELECT deletion_request_id, status, requested_at, attempt_count, last_error_code
    FROM account_deletion_requests WHERE completed_at IS NULL
      AND (status = 'FAILED' OR requested_at <= now() - interval '24 hours')
    ORDER BY requested_at LIMIT 100`, { type: QueryTypes.SELECT });
}

export async function inspectDeletionRequest(deletion_request_id: string): Promise<unknown> {
  assertAccountUuid(deletion_request_id);
  return sequelize.query(`
    SELECT r.deletion_request_id, r.status, r.requested_at, r.available_at, r.attempt_count,
      r.claimed_at, r.images_purged_at, r.db_purged_at, r.cache_purged_at, r.completed_at,
      r.last_error_code,
      EXTRACT(EPOCH FROM now() - r.requested_at)::bigint AS elapsed_seconds,
      (SELECT count(*) FROM account_deletion_operator_actions a
       WHERE a.deletion_request_id = r.deletion_request_id)::int AS manual_retry_count
    FROM account_deletion_requests r WHERE r.deletion_request_id = :deletion_request_id
  `, { replacements: { deletion_request_id }, type: QueryTypes.SELECT });
}

export async function retryDeletionRequest(input: {
  deletion_request_id: string;
  expected_user_id: string;
  expected_status: string;
  expected_attempt_count: number;
  reason: string;
  actor: string;
}): Promise<void> {
  assertAccountUuid(input.deletion_request_id);
  assertAccountUuid(input.expected_user_id);
  if (!retry_reasons.some((reason) => reason === input.reason) ||
      !Number.isSafeInteger(input.expected_attempt_count) || input.expected_attempt_count < 0 ||
      !["FAILED", "RETRY", "PROCESSING", "CACHE_PURGE_PENDING"].includes(input.expected_status) ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(input.actor)) throw new Error("INVALID_RETRY_ARGUMENTS");
  await withAccountDataLock(input.expected_user_id, async () => {
    await sequelize.transaction(async (transaction) => {
      const request = await AccountDeletionRequest.findByPk(input.deletion_request_id, {
        transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!request || request.user_id !== input.expected_user_id || request.completed_at ||
          request.status !== input.expected_status || request.attempt_count !== input.expected_attempt_count) {
        throw new Error("DELETION_RETRY_STATE_CONFLICT");
      }
      if (request.claimed_at && Date.now() - request.claimed_at.getTime() < 5 * 60 * 1000) {
        throw new Error("DELETION_RETRY_LEASE_ACTIVE");
      }
      if (!request.db_purged_at) {
        const user = await User.findByPk(input.expected_user_id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!user || user.account_status !== "DELETION_PENDING") throw new Error("DELETION_RETRY_OWNER_INVALID");
      }
      await sequelize.query(`
        INSERT INTO account_deletion_operator_actions
          (deletion_request_id, actor, reason, previous_status, previous_attempt_count)
        VALUES (:deletion_request_id, :actor, :reason, :expected_status, :expected_attempt_count)
      `, { replacements: input, transaction });
      const tasks = await AccountDeletionProviderTask.findAll({
        where: { deletion_request_id: input.deletion_request_id }, transaction, lock: transaction.LOCK.UPDATE,
      });
      for (const task of tasks) {
        if (task.status === "COMPLETED") continue;
        await task.update({ status: "PENDING", available_at: new Date(), last_error_code: null, updated_at: new Date() }, { transaction });
      }
      await request.update({ status: "PENDING", attempt_count: 0, available_at: new Date(),
        claimed_at: null, claim_token: null, last_error_code: null }, { transaction });
    });
  });
}
