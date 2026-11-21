export class PhoneVerificationError extends Error {
  constructor(
    readonly status_code: number,
    readonly code: string,
    message: string = "휴대폰 인증을 다시 진행해주세요.",
    readonly retry_after_seconds?: number,
  ) {
    super(message);
    this.name = "PhoneVerificationError";
  }
}

export function phoneUnavailable(): PhoneVerificationError {
  return new PhoneVerificationError(503, "PHONE_VERIFICATION_UNAVAILABLE", "휴대폰 인증을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
}
