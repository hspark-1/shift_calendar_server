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
