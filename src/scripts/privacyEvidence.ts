// Explicit allowlist only: never dump process.env or storage credentials.
function safeBoolean(name: string): string {
  const value = process.env[name];
  return value === "true" || value === "false" ? value : "unset-or-invalid";
}

function safeRetention(name: string): string {
  const value = process.env[name];
  return value === undefined ? "30 (default)" : /^\d{1,5}$/.test(value) ? value : "invalid";
}

function safeHostname(name: string): string {
  const value = process.env[name];
  if (!value) return "unset";
  try { return new URL(value).hostname; } catch { return "invalid"; }
}

console.log(JSON.stringify({
  account_deletion_enabled: safeBoolean("ACCOUNT_DELETION_ENABLED"),
  account_deletion_worker_enabled: safeBoolean("ACCOUNT_DELETION_WORKER_ENABLED"),
  push_worker_enabled: safeBoolean("PUSH_WORKER_ENABLED"),
  account_deletion_retention_days: safeRetention("ACCOUNT_DELETION_RETENTION_DAYS"),
  push_terminal_retention_days: safeRetention("PUSH_TERMINAL_RETENTION_DAYS"),
  detached_device_retention_days: 30,
  image_storage_hostname: safeHostname("PROFILE_IMAGE_STORAGE_ENDPOINT"),
  image_public_hostname: safeHostname("PROFILE_IMAGE_PUBLIC_BASE_URL"),
}));
