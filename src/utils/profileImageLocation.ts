const uuid_pattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const key_pattern = new RegExp(`^(local|test|stage|center)/profiles/(${uuid_pattern})/(${uuid_pattern})\\.(jpg|png|webp)$`);

export function isOwnedProfileImageKey(key: string, user_id: string): boolean {
  const match = key_pattern.exec(key);
  return Boolean(match && match[1] === process.env.PROFILE_IMAGE_STORAGE_PREFIX && match[2] === user_id);
}

export function profileImageApiUrl(user_id: string): string {
  const base_url = process.env.PROFILE_IMAGE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  return `${base_url}/api/v1/profile-images/${user_id}`;
}

function legacyBaseUrls(): string[] {
  const bucket = process.env.PROFILE_IMAGE_STORAGE_BUCKET?.trim();
  const region = process.env.PROFILE_IMAGE_STORAGE_REGION?.trim();
  return [
    process.env.PROFILE_IMAGE_PUBLIC_BASE_URL?.trim(),
    bucket && region ? `https://${bucket}.s3.${region}.amazonaws.com` : undefined,
  ].filter((value): value is string => Boolean(value)).map((value) => value.replace(/\/$/, ""));
}

export function legacyProfileImageKey(value: string, user_id?: string): string | null {
  for (const base_url of legacyBaseUrls()) {
    if (!value.startsWith(`${base_url}/`)) continue;
    const key = value.slice(base_url.length + 1);
    const match = key_pattern.exec(key);
    if (match && isOwnedProfileImageKey(key, user_id ?? match[2])) return key;
  }
  return null;
}

// JSON 응답의 ORM, raw SQL, 과거 알림 snapshot에 동일한 이미지 계약을 적용한다.
export function profileImageJsonReplacer(key: string, value: unknown): unknown {
  if (key === "profile_image_key") return undefined;
  if (key !== "profile_image_url" || typeof value !== "string") return value;
  const object_key = legacyProfileImageKey(value);
  if (object_key) return profileImageApiUrl(key_pattern.exec(object_key)![2]);
  // 관리 원본의 잘못된 prefix/경로나 다른 S3 주소를 앱으로 노출하지 않는다.
  if (legacyBaseUrls().some((base_url) => value.startsWith(`${base_url}/`))) return null;
  try {
    const url = new URL(value);
    if (/(^|\.)s3[.-].*amazonaws\.com$/.test(url.hostname) || /\.s3\.amazonaws\.com$/.test(url.hostname)) return null;
  } catch {
    // 서버 상대 경로는 그대로 유지한다.
  }
  return value;
}
