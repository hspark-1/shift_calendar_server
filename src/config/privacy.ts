import { getPositiveIntegerEnvironmentVariable } from "./environment";

// Approved 2026-10-18. Reject drift instead of silently extending retention.
export function getPrivacyRetentionDays(
  name: "ACCOUNT_DELETION_RETENTION_DAYS" | "PUSH_TERMINAL_RETENTION_DAYS",
): number {
  const days = getPositiveIntegerEnvironmentVariable(name, 30);
  if (days !== 30) throw new Error("PRIVACY_RETENTION_POLICY_MISMATCH");
  return days;
}
