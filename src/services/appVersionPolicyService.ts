export type AppPlatform = "IOS" | "ANDROID";

export interface AppVersionPolicy {
  schema_version: 1;
  platform: AppPlatform;
  minimum_compatibility_version: number;
  update_url: string | null;
  message: string;
}

export class AppVersionPolicyConfigurationError extends Error {
  readonly code = "APP_VERSION_POLICY_CONFIGURATION_ERROR";
  constructor(readonly environment_variable: string) {
    super(`앱 호환 정책 설정을 확인해 주세요: ${environment_variable}`);
    this.name = "AppVersionPolicyConfigurationError";
  }
}

function isValidStoreUrl(value: string, platform: AppPlatform): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    if (platform === "IOS") {
      return url.hostname === "apps.apple.com" && !url.search &&
        /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id6831957246\/?$/.test(url.pathname);
    }
    return url.hostname === "play.google.com" && url.pathname === "/store/apps/details" &&
      url.searchParams.getAll("id").length === 1 &&
      url.searchParams.get("id") === "com.hspark.shiftmate";
  } catch {
    return false;
  }
}

export function getAppVersionPolicy(platform: AppPlatform): AppVersionPolicy {
  const minimum_key = `APP_UPDATE_${platform}_MIN_COMPATIBILITY_VERSION`;
  const url_key = `APP_UPDATE_${platform}_URL`;
  const message_key = `APP_UPDATE_${platform}_MESSAGE`;
  const raw_minimum = process.env[minimum_key]?.trim() ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(raw_minimum)) throw new AppVersionPolicyConfigurationError(minimum_key);
  const minimum = Number(raw_minimum);
  if (!Number.isSafeInteger(minimum) || minimum > 2147483647) throw new AppVersionPolicyConfigurationError(minimum_key);
  const update_url = process.env[url_key]?.trim() ||
    (platform === "IOS" ? "https://apps.apple.com/kr/app/id6831957246" : null);
  if ((update_url && !isValidStoreUrl(update_url, platform)) || (minimum > 0 && !update_url)) {
    throw new AppVersionPolicyConfigurationError(url_key);
  }
  const message = process.env[message_key]?.trim() || "안정적인 서비스 이용을 위해 최신 앱으로 업데이트해 주세요.";
  if (message.length > 300) throw new AppVersionPolicyConfigurationError(message_key);
  return {
    schema_version: 1,
    platform,
    minimum_compatibility_version: minimum,
    update_url,
    message,
  };
}

export function validateAppVersionPolicyEnvironment(): void {
  getAppVersionPolicy("IOS");
  getAppVersionPolicy("ANDROID");
}
