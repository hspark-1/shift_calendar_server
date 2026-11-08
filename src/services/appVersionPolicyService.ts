import { app_version_policies, type AppPlatform, type AppVersionPolicySettings } from "../config/appVersionPolicy";
export type { AppPlatform } from "../config/appVersionPolicy";

export interface AppVersionPolicy {
  schema_version: 1;
  platform: AppPlatform;
  minimum_compatibility_version: number;
  update_url: string | null;
  message: string;
}

export class AppVersionPolicyConfigurationError extends Error {
  readonly code = "APP_VERSION_POLICY_CONFIGURATION_ERROR";
  constructor(readonly configuration_field: string) {
    super(`앱 호환 정책 설정을 확인해 주세요: ${configuration_field}`);
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

export function createAppVersionPolicy(platform: AppPlatform, settings: AppVersionPolicySettings): AppVersionPolicy {
  const minimum = settings.minimum_compatibility_version;
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 2147483647) {
    throw new AppVersionPolicyConfigurationError(`${platform}.minimum_compatibility_version`);
  }
  if (settings.update_url !== null && typeof settings.update_url !== "string") {
    throw new AppVersionPolicyConfigurationError(`${platform}.update_url`);
  }
  const update_url = settings.update_url?.trim() ?? null;
  if ((update_url !== null && !isValidStoreUrl(update_url, platform)) || (minimum > 0 && !update_url)) {
    throw new AppVersionPolicyConfigurationError(`${platform}.update_url`);
  }
  if (typeof settings.message !== "string" || !settings.message.trim() || settings.message.trim().length > 300) {
    throw new AppVersionPolicyConfigurationError(`${platform}.message`);
  }
  return {
    schema_version: 1,
    platform,
    minimum_compatibility_version: minimum,
    update_url,
    message: settings.message.trim(),
  };
}

export function getAppVersionPolicy(platform: AppPlatform): AppVersionPolicy {
  return createAppVersionPolicy(platform, app_version_policies[platform]);
}

export function validateAppVersionPolicyConfiguration(): void {
  getAppVersionPolicy("IOS");
  getAppVersionPolicy("ANDROID");
}
