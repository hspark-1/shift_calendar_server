import {
  getBooleanEnvironmentVariable,
  getPositiveIntegerEnvironmentVariable,
} from "./environment";

export function isAccountDeletionEnabled(): boolean {
  return getBooleanEnvironmentVariable("ACCOUNT_DELETION_ENABLED", false);
}

export function isAccountDeletionWorkerEnabled(): boolean {
  return getBooleanEnvironmentVariable(
    "ACCOUNT_DELETION_WORKER_ENABLED",
    false,
  );
}

export function getAccountDeletionReauthSeconds(): number {
  return getPositiveIntegerEnvironmentVariable(
    "ACCOUNT_DELETION_REAUTH_SECONDS",
    600,
  );
}
