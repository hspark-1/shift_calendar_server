import { QueryTypes, Transaction, UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/database";
import {
  AccountDeletionProviderTask,
  AccountDeletionRequest,
  OAuthAuthorization,
  RefreshToken,
  User,
} from "../models";
import { getAccountDeletionReauthSeconds, isAccountDeletionEnabled } from "../config/accountDeletion";
import { getPositiveIntegerEnvironmentVariable } from "../config/environment";
import { unbindAllUserDevices } from "./deviceService";

export type AccountDeletionErrorCode =
  | "ACCOUNT_DELETION_DISABLED"
  | "REAUTHENTICATION_REQUIRED"
  | "ACCOUNT_DELETION_IN_PROGRESS"
  | "ACCOUNT_DELETION_NOT_FOUND";

export class AccountDeletionError extends Error {
  constructor(
    public readonly code: AccountDeletionErrorCode,
    public readonly status_code: number,
    public readonly deletion_request_id?: string,
  ) {
    super(code);
    this.name = "AccountDeletionError";
  }
}

export interface AccountDeletionReceipt {
  deletion_request_id: string;
  status: string;
  requested_at: string;
}

function toReceipt(request: AccountDeletionRequest): AccountDeletionReceipt {
  return {
    deletion_request_id: request.deletion_request_id,
    status: request.status,
    requested_at: request.requested_at.toISOString(),
  };
}

export async function requestAccountDeletion(
  user_id: string,
  auth_time: number | null,
): Promise<AccountDeletionReceipt> {
  if (!isAccountDeletionEnabled()) {
    throw new AccountDeletionError("ACCOUNT_DELETION_DISABLED", 503);
  }
  const now_seconds = Math.floor(Date.now() / 1000);
  if (
    auth_time === null ||
    auth_time <= 0 ||
    now_seconds - auth_time > getAccountDeletionReauthSeconds() ||
    auth_time > now_seconds + 60
  ) {
    throw new AccountDeletionError("REAUTHENTICATION_REQUIRED", 403);
  }

  try {
    return await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(user_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!user) {
        throw new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND", 404);
      }
      if (user.account_status === "DELETION_PENDING") {
        const existing_request = await AccountDeletionRequest.findOne({
          where: { user_id },
          transaction,
        });
        throw new AccountDeletionError(
          "ACCOUNT_DELETION_IN_PROGRESS",
          409,
          existing_request?.deletion_request_id,
        );
      }

      const request = await AccountDeletionRequest.create(
        { user_id },
        { transaction },
      );
      const has_apple_authorization =
        (await OAuthAuthorization.count({
          where: { user_id, provider: "APPLE", revoked_at: null },
          transaction,
        })) > 0;
      if (has_apple_authorization) {
        await AccountDeletionProviderTask.create(
          {
            deletion_request_id: request.deletion_request_id,
            provider: "APPLE",
          },
          { transaction },
        );
      }
      if (user.kakao_id) {
        await AccountDeletionProviderTask.create(
          {
            deletion_request_id: request.deletion_request_id,
            provider: "KAKAO",
          },
          { transaction },
        );
      }

      user.account_status = "DELETION_PENDING";
      user.deletion_requested_at = new Date();
      await user.save({ transaction });
      await RefreshToken.update(
        { revoked_at: new Date() },
        { where: { user_id, revoked_at: null }, transaction },
      );
      await unbindAllUserDevices(user_id, transaction);
      await sequelize.query(
        `
          UPDATE push_jobs
          SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
              cancellation_reason = COALESCE(cancellation_reason, 'ACCOUNT_DELETION_REQUESTED'),
              updated_at = now()
          WHERE receiver_user_id = :user_id
            AND status IN ('PENDING', 'PROCESSING', 'RETRY')
        `,
        { replacements: { user_id }, transaction },
      );
      return toReceipt(request);
    });
  } catch (error) {
    if (error instanceof AccountDeletionError) throw error;
    if (error instanceof UniqueConstraintError) {
      const existing_request = await AccountDeletionRequest.findOne({
        where: { user_id },
      });
      throw new AccountDeletionError(
        "ACCOUNT_DELETION_IN_PROGRESS",
        409,
        existing_request?.deletion_request_id,
      );
    }
    throw error;
  }
}

export async function getAccountDeletionStatus(
  user_id: string,
): Promise<AccountDeletionReceipt> {
  const request = await AccountDeletionRequest.findOne({ where: { user_id } });
  if (!request) {
    throw new AccountDeletionError("ACCOUNT_DELETION_NOT_FOUND", 404);
  }
  return toReceipt(request);
}

interface OwnerGroupRow {
  group_id: string;
}

interface NewOwnerRow {
  group_member_id: string;
}

interface CacheMonthRow {
  year_month: string | Date;
}

export async function purgeAccountData(
  request: AccountDeletionRequest,
): Promise<void> {
  const user_id = request.user_id;
  if (!user_id) return;

  await sequelize.transaction(async (transaction) => {
    const locked_request = await AccountDeletionRequest.findByPk(
      request.deletion_request_id,
      { transaction, lock: transaction.LOCK.UPDATE },
    );
    if (!locked_request || locked_request.db_purged_at) return;
    const user = await User.findByPk(user_id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user || user.account_status !== "DELETION_PENDING") {
      throw new Error("ACCOUNT_DELETION_USER_STATE_INVALID");
    }

    const cache_month_rows = await sequelize.query<CacheMonthRow>(
      `
        SELECT DISTINCT year_month
        FROM work_shift_month_states
        WHERE owner_user_id = :user_id
        ORDER BY year_month
      `,
      { replacements: { user_id }, type: QueryTypes.SELECT, transaction },
    );
    const cache_year_months = cache_month_rows.map((row) =>
      row.year_month instanceof Date
        ? row.year_month.toISOString().slice(0, 10)
        : String(row.year_month).slice(0, 10),
    );

    const owner_groups = await sequelize.query<OwnerGroupRow>(
      `
        SELECT g.group_id
        FROM groups g
        JOIN group_members owner_member
          ON owner_member.group_id = g.group_id
         AND owner_member.user_id = :user_id
         AND owner_member.role = 'OWNER'
         AND owner_member.removed_at IS NULL
        WHERE g.deleted_at IS NULL
        ORDER BY g.group_id
        FOR UPDATE OF g, owner_member
      `,
      { replacements: { user_id }, type: QueryTypes.SELECT, transaction },
    );

    for (const { group_id } of owner_groups) {
      const candidates = await sequelize.query<NewOwnerRow>(
        `
          SELECT group_member_id
          FROM group_members
          WHERE group_id = :group_id
            AND user_id <> :user_id
            AND removed_at IS NULL
          ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END,
                   joined_at ASC,
                   user_id ASC
          LIMIT 1
          FOR UPDATE
        `,
        {
          replacements: { group_id, user_id },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (candidates.length === 0) {
        await sequelize.query(
          "DELETE FROM group_invitations WHERE group_id = :group_id",
          { replacements: { group_id }, transaction },
        );
        await sequelize.query(
          "DELETE FROM group_members WHERE group_id = :group_id",
          { replacements: { group_id }, transaction },
        );
        await sequelize.query("DELETE FROM groups WHERE group_id = :group_id", {
          replacements: { group_id },
          transaction,
        });
        continue;
      }
      await sequelize.query(
        `
          UPDATE group_members
          SET role = 'MEMBER', updated_at = now()
          WHERE group_id = :group_id
            AND user_id = :user_id
            AND role = 'OWNER'
            AND removed_at IS NULL
        `,
        { replacements: { group_id, user_id }, transaction },
      );
      await sequelize.query(
        `
          UPDATE group_members
          SET role = 'OWNER', updated_at = now()
          WHERE group_member_id = :group_member_id
        `,
        {
          replacements: {
            group_member_id: candidates[0].group_member_id,
          },
          transaction,
        },
      );
      await sequelize.query(
        "UPDATE groups SET updated_at = now() WHERE group_id = :group_id",
        { replacements: { group_id }, transaction },
      );
    }

    await sequelize.query(
      `
        DELETE FROM notifications
        WHERE user_id = :user_id
           OR payload->>'related_user_id' = :user_id
           OR payload->>'inviter_user_id' = :user_id
      `,
      { replacements: { user_id }, transaction },
    );
    await sequelize.query(
      `DELETE FROM group_invitations
       WHERE inviter_user_id = :user_id OR invitee_user_id = :user_id`,
      { replacements: { user_id }, transaction },
    );
    await sequelize.query("DELETE FROM group_members WHERE user_id = :user_id", {
      replacements: { user_id },
      transaction,
    });
    await sequelize.query(
      `DELETE FROM friend_requests
       WHERE requester_user_id = :user_id OR addressee_user_id = :user_id`,
      { replacements: { user_id }, transaction },
    );
    await sequelize.query(
      `DELETE FROM friendships WHERE user_id_a = :user_id OR user_id_b = :user_id`,
      { replacements: { user_id }, transaction },
    );
    await sequelize.query(
      `DELETE FROM friend_level_settings
       WHERE owner_user_id = :user_id OR friend_user_id = :user_id`,
      { replacements: { user_id }, transaction },
    );
    await sequelize.query("DELETE FROM work_shifts WHERE owner_user_id = :user_id", {
      replacements: { user_id },
      transaction,
    });
    await sequelize.query("DELETE FROM events WHERE owner_user_id = :user_id", {
      replacements: { user_id },
      transaction,
    });
    await sequelize.query(
      "DELETE FROM work_shift_cache_outbox WHERE owner_user_id = :user_id",
      { replacements: { user_id }, transaction },
    );
    await sequelize.query(
      "DELETE FROM work_shift_month_states WHERE owner_user_id = :user_id",
      { replacements: { user_id }, transaction },
    );
    await sequelize.query(
      `
        DELETE FROM shift_type_schedules
        WHERE shift_type_id IN (
          SELECT st.shift_type_id FROM shift_types st
          JOIN shift_templates t ON t.template_id = st.template_id
          WHERE t.owner_user_id = :user_id
        ) OR template_version_id IN (
          SELECT v.template_version_id FROM shift_template_versions v
          JOIN shift_templates t ON t.template_id = v.template_id
          WHERE t.owner_user_id = :user_id
        )
      `,
      { replacements: { user_id }, transaction },
    );
    await sequelize.query("DELETE FROM shift_templates WHERE owner_user_id = :user_id", {
      replacements: { user_id },
      transaction,
    });
    await sequelize.query("DELETE FROM users WHERE user_id = :user_id", {
      replacements: { user_id },
      transaction,
    });

    locked_request.status = "CACHE_PURGE_PENDING";
    locked_request.cache_year_months = cache_year_months;
    locked_request.db_purged_at = new Date();
    locked_request.last_error_code = null;
    await locked_request.save({ transaction });
  });
}

export async function cleanupCompletedAccountDeletionRequests(): Promise<void> {
  await sequelize.query(
    `
      DELETE FROM account_deletion_requests
      WHERE status = 'COMPLETED'
        AND completed_at < now() - make_interval(
          days => :retention_days
        )
    `,
    {
      replacements: {
        retention_days: getPositiveIntegerEnvironmentVariable(
          "ACCOUNT_DELETION_RETENTION_DAYS",
          30,
        ),
      },
    },
  );
}
