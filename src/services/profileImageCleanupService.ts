import { QueryTypes, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import { User } from "../models";
import { withAccountDataLock } from "../utils/accountDataLock";
import { isOwnedProfileImageKey, legacyProfileImageKey } from "../utils/profileImageLocation";
import { logError } from "../utils/logger";
import { getAccountImageScope } from "./accountDeletionImageService";
import { deleteProfileImage } from "./profileImageStorageService";

interface CleanupTask {
  object_key: string;
  owner_user_id: string;
  storage_fingerprint: string;
  request_id: string | null;
}

export async function enqueueProfileImageCleanup(
  user_id: string,
  key: string,
  request_id?: string,
  transaction?: Transaction,
): Promise<void> {
  if (!isOwnedProfileImageKey(key, user_id)) throw new Error("INVALID_PROFILE_IMAGE_KEY");
  await sequelize.query(`
    INSERT INTO profile_image_cleanup_tasks
      (object_key, owner_user_id, storage_fingerprint, request_id)
    VALUES (:key, :user_id, :fingerprint, :request_id)
    ON CONFLICT (object_key) DO NOTHING
  `, { replacements: { key, user_id, fingerprint: getAccountImageScope(user_id).storage_fingerprint,
    request_id: request_id ?? null }, transaction });
}

export async function cancelProfileImageCleanup(key: string, transaction: Transaction): Promise<void> {
  await sequelize.query("DELETE FROM profile_image_cleanup_tasks WHERE object_key = :key", {
    replacements: { key }, transaction,
  });
}

// 호출자는 account-data session lock을 보유한다. 현재 이미지는 삭제하지 않는다.
export async function cleanupProfileImagesForLockedAccount(user_id: string): Promise<void> {
  const tasks = await sequelize.query<CleanupTask>(`
    SELECT object_key, owner_user_id, storage_fingerprint, request_id
    FROM profile_image_cleanup_tasks
    WHERE owner_user_id = :user_id AND next_attempt_at <= now()
    ORDER BY created_at LIMIT 10
  `, { replacements: { user_id }, type: QueryTypes.SELECT });
  for (const task of tasks) {
    try {
      if (!isOwnedProfileImageKey(task.object_key, user_id) ||
          task.storage_fingerprint !== getAccountImageScope(user_id).storage_fingerprint) {
        throw new Error("PROFILE_IMAGE_STORAGE_CHANGED");
      }
      const user = await User.findByPk(user_id);
      const current_key = user?.profile_image_key ??
        (user?.profile_image_url ? legacyProfileImageKey(user.profile_image_url, user_id) : null);
      if (current_key !== task.object_key) await deleteProfileImage(task.object_key);
      await sequelize.query("DELETE FROM profile_image_cleanup_tasks WHERE object_key = :key", {
        replacements: { key: task.object_key },
      });
    } catch {
      // SDK/DB 원문·key·개인정보는 로그에 넣지 않는다. 실패 작업은 영속 보존한다.
      logError("profile_image_cleanup_failed", { code: "PROFILE_IMAGE_CLEANUP_RETRY" }, task.request_id ?? undefined);
      await sequelize.query(`
        UPDATE profile_image_cleanup_tasks
        SET attempt_count = attempt_count + 1,
            next_attempt_at = now() + interval '10 minutes',
            last_error_code = 'PROFILE_IMAGE_CLEANUP_RETRY'
        WHERE object_key = :key
      `, { replacements: { key: task.object_key } });
    }
  }
}

export async function processProfileImageCleanupBatch(): Promise<void> {
  const owners = await sequelize.query<{ owner_user_id: string }>(`
    SELECT owner_user_id FROM profile_image_cleanup_tasks
    WHERE next_attempt_at <= now()
      AND object_key LIKE :prefix
    GROUP BY owner_user_id ORDER BY min(next_attempt_at) LIMIT 10
  `, { replacements: { prefix: `${process.env.PROFILE_IMAGE_STORAGE_PREFIX}/profiles/%` }, type: QueryTypes.SELECT });
  for (const { owner_user_id } of owners) {
    try {
      await withAccountDataLock(owner_user_id, () => cleanupProfileImagesForLockedAccount(owner_user_id));
    } catch (error) {
      if (!(error instanceof Error && error.message === "ACCOUNT_DATA_BUSY")) {
        logError("profile_image_cleanup_batch_failed", { code: "PROFILE_IMAGE_CLEANUP_RETRY" });
      }
    }
  }
}
