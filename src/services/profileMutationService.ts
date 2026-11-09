import { Transaction } from "sequelize";
import { User } from "../models";
import { withAccountDataLock } from "../utils/accountDataLock";
import { logError } from "../utils/logger";
import { ProfileImage, createProfileImageKey, uploadProfileImage } from "./profileImageStorageService";
import { cancelProfileImageCleanup, cleanupProfileImagesForLockedAccount, enqueueProfileImageCleanup } from "./profileImageCleanupService";
import { completeProfile, ProfileError, updateProfileFields, UpdateProfileInput, validateProfileInput } from "./profileService";

// HTTP 입력은 명시된 필드만 받으며 internal key/계정 ID/완료 시각은 전달하지 않는다.
export async function mutateProfile(
  user_id: string,
  body: UpdateProfileInput,
  image: ProfileImage | undefined,
  complete: boolean,
  request_id?: string,
): Promise<User> {
  const input: UpdateProfileInput = {
    name: body?.name, timezone: body?.timezone, phone: body?.phone,
    job_type: body?.job_type, workplace: body?.workplace,
    ...(!complete ? { profile_image_url: body?.profile_image_url } : {}),
  };
  if (image && body?.profile_image_url !== undefined) {
    throw new ProfileError(400, "VALIDATION_ERROR", "profile_image와 profile_image_url은 함께 전송할 수 없습니다.");
  }
  // 텍스트만 수정하는 기존 JSON 경로는 row lock만으로 원자성을 유지한다.
  if (!image && input.profile_image_url === undefined) {
    validateProfileInput(input, complete);
    return complete
      ? completeProfile(user_id, { ...input, name: input.name, phone: input.phone, timezone: input.timezone })
      : updateProfileFields(user_id, input);
  }
  let committed_user: User | undefined;
  try {
    return await withAccountDataLock(user_id, async () => {
      const active_user = await User.findByPk(user_id);
      if (!active_user || active_user.account_status !== "ACTIVE") {
        throw new ProfileError(401, "UNAUTHORIZED", "인증이 필요합니다.");
      }
      validateProfileInput(input, complete);
      try {
        let key: string | undefined;
        if (image) {
          key = createProfileImageKey(user_id, image.extension);
          // 업로드 성공 응답 유실/프로세스 종료도 worker가 복구할 수 있게 먼저 기록한다.
          await enqueueProfileImageCleanup(user_id, key, request_id);
          try {
            await uploadProfileImage(user_id, image, key);
          } catch {
            logError("profile_image_upload_failed", { code: "PROFILE_IMAGE_STORAGE_UNAVAILABLE" }, request_id);
            throw new ProfileError(503, "PROFILE_IMAGE_STORAGE_UNAVAILABLE", "프로필 이미지를 저장할 수 없습니다. 잠시 후 다시 시도해주세요.");
          }
        }
        const options = {
          profile_image_key: key,
          on_image_change: async (previous_key: string | null, next_key: string | null, transaction: Transaction) => {
            if (next_key) await cancelProfileImageCleanup(next_key, transaction);
            if (previous_key) await enqueueProfileImageCleanup(user_id, previous_key, request_id, transaction);
          },
        };
        committed_user = complete
          ? await completeProfile(user_id, { ...input, name: input.name, phone: input.phone, timezone: input.timezone }, options)
          : await updateProfileFields(user_id, input, options);
        return committed_user;
      } finally {
        // commit 후 실패는 이미 저장된 프로필의 성공 결과에 영향을 주지 않는다.
        try {
          await cleanupProfileImagesForLockedAccount(user_id);
        } catch {
          logError("profile_image_cleanup_failed", { code: "PROFILE_IMAGE_CLEANUP_RETRY" }, request_id);
        }
      }
    });
  } catch (error) {
    // commit 이후 lock connection 정리 오류도 새 사진 삭제/실패 응답으로 바꾸지 않는다.
    if (committed_user) {
      logError("profile_image_lock_release_failed", { code: "PROFILE_IMAGE_LOCK_RELEASE_FAILED" }, request_id);
      return committed_user;
    }
    if (error instanceof Error && error.message === "ACCOUNT_DATA_BUSY") {
      throw new ProfileError(503, "PROFILE_IMAGE_STORAGE_UNAVAILABLE", "프로필 수정이 진행 중입니다. 잠시 후 다시 시도해주세요.");
    }
    throw error;
  }
}
