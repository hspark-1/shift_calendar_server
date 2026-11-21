import fs from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { EnvironmentValidationError, getPositiveIntegerEnvironmentVariable, getRequiredEnvironmentVariable } from "./environment";

interface PhoneKeyRing { current: string; keys: Record<string, string> }
let cached_keys: { path: string; ring: PhoneKeyRing } | undefined;

// Secret file: {"current":"v1","keys":{"v1":"<32-byte base64>"}}.
// A process restart is required for rotation; all instances retain overlapping keys.
export function getPhoneKeys(): PhoneKeyRing {
  const key_path = getRequiredEnvironmentVariable("PHONE_VERIFICATION_HMAC_KEY_FILE");
  if (cached_keys?.path === key_path) return cached_keys.ring;
  try {
    const ring = JSON.parse(fs.readFileSync(key_path, "utf8")) as PhoneKeyRing;
    if (!ring || !ring.keys || typeof ring.keys !== "object" || Array.isArray(ring.keys) || typeof ring.current !== "string" || !Object.hasOwn(ring.keys, ring.current)) throw new Error();
    const entries = Object.entries(ring.keys);
    if (entries.length < 1 || entries.length > 5) throw new Error();
    for (const [version, key] of entries) {
      if (!/^[a-zA-Z0-9_-]{1,24}$/.test(version) || typeof key !== "string" || Buffer.from(key, "base64").length !== 32 || Buffer.from(key, "base64").toString("base64") !== key) throw new Error();
    }
    cached_keys = { path: key_path, ring };
    return ring;
  } catch {
    throw new EnvironmentValidationError("PHONE_VERIFICATION_HMAC_KEY_FILE", "휴대폰 인증 키 파일 형식을 확인해주세요.");
  }
}

export function phoneDigest(purpose: string, value: unknown, version = getPhoneKeys().current): string {
  const key = getPhoneKeys().keys[version];
  if (!key) throw new EnvironmentValidationError("PHONE_VERIFICATION_HMAC_KEY_FILE", "복구 기간의 이전 인증 키가 필요합니다.");
  const derived_key = createHmac("sha256", Buffer.from(key, "base64")).update(`shiftmate:phone:${purpose}`).digest();
  return createHmac("sha256", derived_key).update(JSON.stringify(value)).digest("hex");
}

export function equalDigest(left: string, right: string): boolean {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function getPhoneConfig() {
  return {
    project_id: getRequiredEnvironmentVariable("PHONE_AUTH_FIREBASE_PROJECT_ID"),
    challenge_ttl: getPositiveIntegerEnvironmentVariable("PHONE_CHALLENGE_TTL_SECONDS", 600),
    auth_max_age: getPositiveIntegerEnvironmentVariable("PHONE_FIREBASE_AUTH_MAX_AGE_SECONDS", 300),
    clock_skew: getPositiveIntegerEnvironmentVariable("PHONE_FIREBASE_AUTH_CLOCK_SKEW_SECONDS", 5, { allow_zero: true }),
    proof_ttl: getPositiveIntegerEnvironmentVariable("PHONE_PROOF_TTL_SECONDS", 300),
    challenge_user_limit: getPositiveIntegerEnvironmentVariable("PHONE_CHALLENGE_PER_USER_HOUR", 10),
    challenge_ip_limit: getPositiveIntegerEnvironmentVariable("PHONE_CHALLENGE_PER_IP_HOUR", 30),
    exchange_user_limit: getPositiveIntegerEnvironmentVariable("PHONE_EXCHANGE_PER_USER_WINDOW", 30),
    exchange_ip_limit: getPositiveIntegerEnvironmentVariable("PHONE_EXCHANGE_PER_IP_WINDOW", 100),
  };
}

export function validatePhoneVerificationEnvironment(): void {
  const config = getPhoneConfig();
  getPhoneKeys();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.project_id)) throw new EnvironmentValidationError("PHONE_AUTH_FIREBASE_PROJECT_ID", "Firebase project ID 형식을 확인해주세요.");
  if (config.challenge_ttl > 3600 || config.auth_max_age > 600 || config.proof_ttl > 3600 || config.clock_skew > 5) throw new Error("PHONE_VERIFICATION_TIME_LIMIT_INVALID");
  // Emulator verification must never be enabled in the API process, including Stage.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new EnvironmentValidationError("FIREBASE_AUTH_EMULATOR_HOST", "API 프로세스에서 Auth Emulator를 사용할 수 없습니다.");
}
