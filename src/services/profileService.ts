import { Transaction, UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/database";
import { User } from "../models";
import { isValidIanaTimezone } from "./groupService";
import { normalizePhoneNumber } from "../utils/phone";

export const job_types = ["NURSE", "DOCTOR", "EMT", "OTHER"] as const;
export type JobType = (typeof job_types)[number];

export class ProfileError extends Error {
  constructor(
    readonly status_code: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileError";
  }
}

function normalizeRequiredText(
  value: unknown,
  field_name: string,
  max_length: number,
): string {
  if (typeof value !== "string") {
    throw new ProfileError(400, "VALIDATION_ERROR", `${field_name}은 필수입니다.`);
  }
  const normalized_value = value.trim();
  const length = Array.from(normalized_value).length;
  if (length < 1 || length > max_length) {
    throw new ProfileError(
      400,
      "VALIDATION_ERROR",
      `${field_name}은 trim 후 1~${max_length}자여야 합니다.`,
    );
  }
  return normalized_value;
}

function normalizeOptionalText(value: unknown, max_length: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ProfileError(400, "VALIDATION_ERROR", "선택 입력값 형식이 올바르지 않습니다.");
  }
  const normalized_value = value.trim();
  if (normalized_value.length === 0) return null;
  const length = Array.from(normalized_value).length;
  if (length > max_length) {
    throw new ProfileError(400, "VALIDATION_ERROR", `선택 입력값은 ${max_length}자 이하여야 합니다.`);
  }
  return normalized_value;
}

function normalizeTimezone(value: unknown): string {
  if (typeof value !== "string" || !isValidIanaTimezone(value.trim())) {
    throw new ProfileError(400, "INVALID_TIMEZONE", "지원하지 않는 타임존입니다.");
  }
  return value.trim();
}

function normalizePhone(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProfileError(400, "INVALID_PHONE", "유효한 휴대폰 번호가 필요합니다.");
  }
  const normalized_phone = normalizePhoneNumber(value);
  if (!normalized_phone) {
    throw new ProfileError(
      400,
      "INVALID_PHONE",
      "전화번호는 10~11자리 숫자여야 합니다.",
    );
  }
  return normalized_phone;
}

function normalizeJobType(value: unknown): JobType | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ProfileError(400, "INVALID_JOB_TYPE", "지원하지 않는 직종입니다.");
  }
  const normalized_value = value.trim();
  if (normalized_value === "") return null;
  if (!job_types.includes(normalized_value as JobType)) {
    throw new ProfileError(400, "INVALID_JOB_TYPE", "지원하지 않는 직종입니다.");
  }
  return normalized_value as JobType;
}

function isPhoneUniqueConstraint(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) return false;
  return error.errors.some(
    (item) => item.path === "phone" || item.path === "idx_users_phone",
  );
}

async function assertPhoneAvailable(
  phone: string,
  current_user_id: string,
  transaction: Transaction,
): Promise<void> {
  const existing_user = await User.findOne({
    where: { phone },
    attributes: ["user_id"],
    transaction,
  });
  if (existing_user && existing_user.user_id !== current_user_id) {
    throw new ProfileError(409, "PHONE_ALREADY_EXISTS", "이미 사용 중인 전화번호입니다.");
  }
}

export interface CompleteProfileInput {
  name: unknown;
  timezone: unknown;
  phone: unknown;
  job_type?: unknown;
  workplace?: unknown;
  profile_image_url?: string;
}

export async function completeProfile(
  user_id: string,
  input: CompleteProfileInput,
): Promise<User> {
  const normalized = {
    name: normalizeRequiredText(input.name, "name", 50),
    timezone: normalizeTimezone(input.timezone),
    phone: normalizePhone(input.phone),
    job_type: normalizeJobType(input.job_type),
    workplace: normalizeOptionalText(input.workplace, 100),
  };

  try {
    return await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(user_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!user || user.account_status !== "ACTIVE") {
        throw new ProfileError(401, "UNAUTHORIZED", "인증이 필요합니다.");
      }
      await assertPhoneAvailable(normalized.phone, user_id, transaction);
      user.name = normalized.name;
      user.timezone = normalized.timezone;
      user.phone = normalized.phone;
      user.job_type = normalized.job_type;
      user.workplace = normalized.workplace;
      if (input.profile_image_url !== undefined) {
        user.profile_image_url = input.profile_image_url;
      }
      if (user.profile_completed_at == null) {
        user.profile_completed_at = new Date();
      }
      await user.save({ transaction });
      return user;
    });
  } catch (error) {
    if (isPhoneUniqueConstraint(error)) {
      throw new ProfileError(409, "PHONE_ALREADY_EXISTS", "이미 사용 중인 전화번호입니다.");
    }
    throw error;
  }
}

export interface UpdateProfileInput {
  name?: unknown;
  timezone?: unknown;
  profile_image_url?: unknown;
  phone?: unknown;
  job_type?: unknown;
  workplace?: unknown;
}

export async function updateProfileFields(
  user_id: string,
  input: UpdateProfileInput,
): Promise<User> {
  try {
    return await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(user_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!user || user.account_status !== "ACTIVE") {
        throw new ProfileError(401, "UNAUTHORIZED", "인증이 필요합니다.");
      }

      if (input.name !== undefined) {
        user.name = normalizeRequiredText(input.name, "name", 50);
      }
      if (input.timezone !== undefined) {
        user.timezone = normalizeTimezone(input.timezone);
      }
      if (input.phone !== undefined) {
        const phone = normalizePhone(input.phone);
        await assertPhoneAvailable(phone, user_id, transaction);
        user.phone = phone;
      }
      if (input.job_type !== undefined) {
        user.job_type = normalizeJobType(input.job_type);
      }
      if (input.workplace !== undefined) {
        user.workplace = normalizeOptionalText(input.workplace, 100);
      }
      if (input.profile_image_url !== undefined) {
        user.profile_image_url = normalizeOptionalText(input.profile_image_url, 2048);
      }

      await user.save({ transaction });
      return user;
    });
  } catch (error) {
    if (isPhoneUniqueConstraint(error)) {
      throw new ProfileError(409, "PHONE_ALREADY_EXISTS", "이미 사용 중인 전화번호입니다.");
    }
    throw error;
  }
}
