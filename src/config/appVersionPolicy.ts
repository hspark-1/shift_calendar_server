export type AppPlatform = "IOS" | "ANDROID";

export interface AppVersionPolicySettings {
  readonly minimum_compatibility_version: number;
  readonly update_url: string | null;
  readonly message: string;
}

const update_message = "안정적인 서비스 이용을 위해 최신 앱으로 업데이트해 주세요.";

// 정책 변경은 이 파일에서 검토하고 서버 재실행/재배포로 반영합니다.
// 0: 차단 비활성, 1: 앱 내부 호환 번호 1 이상 허용.
export const app_version_policies: Readonly<Record<AppPlatform, AppVersionPolicySettings>> = Object.freeze({
  IOS: Object.freeze({
    minimum_compatibility_version: 1,
    update_url: "https://apps.apple.com/kr/app/id6831957246",
    message: update_message,
  }),
  ANDROID: Object.freeze({
    minimum_compatibility_version: 1,
    update_url: "https://play.google.com/store/apps/details?id=com.hspark.shiftmate",
    message: update_message,
  }),
});
