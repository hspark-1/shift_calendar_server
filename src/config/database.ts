import { Sequelize } from "sequelize";
import { getPositiveIntegerEnvironmentVariable } from "./environment";

const db_host = process.env.DB_HOST || "localhost";
const db_port = getPositiveIntegerEnvironmentVariable("DB_PORT", 5432);
const db_name = process.env.DB_NAME || "shift_calendar";
const db_user = process.env.DB_USER || "postgres";
const db_password = process.env.DB_PASSWORD || "";
const db_pool_max = getPositiveIntegerEnvironmentVariable("DB_POOL_MAX", 10);
const db_pool_min = getPositiveIntegerEnvironmentVariable(
  "DB_POOL_MIN",
  0,
  { allow_zero: true }
);
const db_pool_acquire_ms = getPositiveIntegerEnvironmentVariable(
  "DB_POOL_ACQUIRE_MS",
  30000
);
const db_pool_idle_ms = getPositiveIntegerEnvironmentVariable(
  "DB_POOL_IDLE_MS",
  10000
);

export const sequelize = new Sequelize(db_name, db_user, db_password, {
  host: db_host,
  port: db_port,
  dialect: "postgres",
  logging: false,
  pool: {
    max: db_pool_max,
    min: db_pool_min,
    acquire: db_pool_acquire_ms,
    idle: db_pool_idle_ms,
  },
  define: {
    timestamps: true,
    underscored: true,
  },
  dialectOptions: {
    ssl:
      process.env.DB_SSL === "true"
        ? {
            require: true,
            rejectUnauthorized: false,
          }
        : false,
  },
});

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
  console.log("✅ PostgreSQL 데이터베이스 연결 성공");
}

export async function checkDatabaseConnection(): Promise<void> {
  await sequelize.query("SELECT 1");
}

export async function disconnectDatabase(): Promise<void> {
  await sequelize.close();
}
