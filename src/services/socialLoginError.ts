import type { User } from "../models";
import { UniqueConstraintError } from "sequelize";

// 공급자 오류와 분리해 모든 로그인 경로와 최종 토큰 발급 경계에서 공유한다.
export class SocialLoginError extends Error {
  readonly code = "ACCOUNT_DELETION_IN_PROGRESS";
  readonly status_code = 409;

  constructor() {
    super(
      "회원 탈퇴가 진행 중입니다.\n탈퇴 처리가 완료된 후 다시 가입해주세요.",
    );
    this.name = "SocialLoginError";
  }
}

export function assertLoginAllowed(
  user: Pick<User, "account_status"> | null,
): void {
  if (user && user.account_status !== "ACTIVE") {
    throw new SocialLoginError();
  }
}

export function isUserUniqueConstraint(
  error: UniqueConstraintError,
  field: "email" | "phone" | "naver_id" | "kakao_id",
): boolean {
  const constraint_names = [
    field,
    `idx_users_${field}`,
    `uq_users_${field}`,
    `users_${field}_key`,
  ];
  const constraint = (error.parent as { constraint?: string } | undefined)
    ?.constraint;
  return (
    error.errors.some((item) => constraint_names.includes(item.path ?? "")) ||
    Object.prototype.hasOwnProperty.call(error.fields ?? {}, field) ||
    (typeof constraint === "string" && constraint_names.includes(constraint))
  );
}
