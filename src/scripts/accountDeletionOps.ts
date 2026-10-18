import os from "os";
import { sequelize } from "../config/database";
import { getDeletionMonitor, listDeletionAttention, inspectDeletionRequest, retryDeletionRequest } from "../services/accountDeletionOperationsService";

async function main(): Promise<void> {
  const [command, request_id, user_id, status, attempts, reason] = process.argv.slice(2);
  if (command === "monitor") {
    const result = await getDeletionMonitor();
    console.log(JSON.stringify(result));
    if (result.worker_stale || result.push_worker_stale || Number(result.push_long_pending_count) > 0 || Number(result.failed_count) > 0 || Number(result.overdue_count) > 0 ||
        Number(result.long_pending_count) > 0) process.exitCode = 2;
  } else if (command === "attention") {
    console.log(JSON.stringify(await listDeletionAttention()));
  } else if (command === "inspect" && request_id) {
    console.log(JSON.stringify(await inspectDeletionRequest(request_id)));
  } else if (command === "retry" && request_id && user_id && status && attempts && reason) {
    // No public HTTP route: require root in a restricted ops execution environment.
    if (process.getuid?.() !== 0) throw new Error("DELETION_OPS_ROOT_REQUIRED");
    await retryDeletionRequest({ deletion_request_id: request_id, expected_user_id: user_id,
      expected_status: status, expected_attempt_count: Number(attempts), reason, actor: os.userInfo().username });
    console.log(JSON.stringify({ status: "QUEUED" }));
  } else {
    throw new Error("DELETION_OPS_USAGE");
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // Do not serialize DB/storage errors or CLI arguments (may contain identifiers).
    const safe_codes = ["INVALID_ACCOUNT_UUID", "INVALID_RETRY_ARGUMENTS", "DELETION_RETRY_STATE_CONFLICT",
      "DELETION_RETRY_LEASE_ACTIVE", "DELETION_RETRY_OWNER_INVALID", "ACCOUNT_DATA_BUSY",
      "DELETION_OPS_ROOT_REQUIRED", "DELETION_OPS_USAGE"];
    const code = error instanceof Error && safe_codes.includes(error.message) ? error.message : "DELETION_OPS_FAILED";
    console.error(JSON.stringify({ code }));
    process.exitCode = 1;
  }).finally(() => sequelize.close());
}
