export const stored_phone_pattern = /^[0-9]{3}-[0-9]{3,4}-[0-9]{4}$/;

export function normalizePhoneNumber(phone: string): string | null {
  const trimmed_phone = phone.trim();

  if (stored_phone_pattern.test(trimmed_phone)) {
    return trimmed_phone;
  }

  if (trimmed_phone.includes("-")) {
    return null;
  }

  const digits_only = trimmed_phone.replace(/-/g, "");

  if (!/^[0-9]+$/.test(digits_only)) {
    return null;
  }

  if (digits_only.length === 10) {
    return `${digits_only.slice(0, 3)}-${digits_only.slice(3, 6)}-${digits_only.slice(6)}`;
  }

  if (digits_only.length === 11) {
    return `${digits_only.slice(0, 3)}-${digits_only.slice(3, 7)}-${digits_only.slice(7)}`;
  }

  return null;
}

export function isPhoneNumberInput(phone: string): boolean {
  return normalizePhoneNumber(phone) !== null;
}

// 신규 번호 인증에만 적용한다. 기존 저장/검색의 정규화 계약은 유지한다.
export function normalizeKoreanMobile(value: unknown): { phone: string; digits: string; e164: string } | null {
  if (typeof value !== "string") return null;
  const phone = normalizePhoneNumber(value);
  if (!phone) return null;
  const digits = phone.replace(/-/g, "");
  if (!/^01[016789][0-9]{7,8}$/.test(digits)) return null;
  return { phone, digits, e164: `+82${digits.slice(1)}` };
}

export function normalizeFirebasePhone(value: unknown): ReturnType<typeof normalizeKoreanMobile> {
  if (typeof value !== "string" || !/^\+821[016789][0-9]{7,8}$/.test(value)) return null;
  return normalizeKoreanMobile(`0${value.slice(3)}`);
}
