import { sequelize } from "../config/database";
import { getPositiveIntegerEnvironmentVariable } from "../config/environment";

let active_locks = 0;

export function assertAccountUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("INVALID_ACCOUNT_UUID");
  }
}

// Session lock: external storage I/O never holds an open DB transaction.
// Destroy the dedicated connection on exit so a pooled session cannot retain a lock.
export async function withAccountDataLock<T>(
  user_id: string,
  action: () => Promise<T>,
): Promise<T> {
  assertAccountUuid(user_id);
  // Reserve capacity for actions' normal queries/transactions. Concurrent uploads
  // must not exhaust the pool with lock sessions and wait for each other forever.
  const lock_limit = Math.floor(getPositiveIntegerEnvironmentVariable("DB_POOL_MAX", 10) / 2);
  if (active_locks >= lock_limit) throw new Error("ACCOUNT_DATA_BUSY");
  active_locks += 1;
  let connection: object | undefined;
  try {
    connection = await sequelize.connectionManager.getConnection({ type: "write" });
    const client = connection as unknown as {
      query(sql: string, values: string[]): Promise<{ rows: Array<{ locked: boolean }> }>;
    };
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [`account-data:${user_id.toLowerCase()}`],
    );
    if (!result.rows[0]?.locked) throw new Error("ACCOUNT_DATA_BUSY");
    return await action();
  } finally {
    try {
      if (connection) await sequelize.connectionManager.destroyConnection(connection);
    } finally {
      active_locks -= 1;
    }
  }
}
