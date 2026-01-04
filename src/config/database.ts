import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

const db_host = process.env.DB_HOST || "localhost";
const db_port = parseInt(process.env.DB_PORT || "5432", 10);
const db_name = process.env.DB_NAME || "shift_calendar";
const db_user = process.env.DB_USER || "postgres";
const db_password = process.env.DB_PASSWORD || "";

export const sequelize = new Sequelize(db_name, db_user, db_password, {
  host: db_host,
  port: db_port,
  dialect: "postgres",
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
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
  try {
    await sequelize.authenticate();
    console.log("✅ PostgreSQL 데이터베이스 연결 성공");

    // 개발 환경에서 모델 동기화
    // 주의: 뷰가 의존하는 컬럼이 있으면 alter가 실패할 수 있으므로
    // 스키마 변경은 수동으로 DDL을 실행하는 것을 권장합니다.
    if (
      process.env.NODE_ENV === "development" &&
      process.env.DB_SYNC === "true"
    ) {
      // force: true는 모든 테이블을 DROP하고 재생성 (데이터 손실 위험)
      // alter: true는 컬럼 타입 변경 시 뷰 의존성 문제로 실패할 수 있음
      await sequelize.sync({ alter: false });
      console.log("✅ 데이터베이스 모델 동기화 완료");
    } else {
      console.log(
        "ℹ️  자동 스키마 동기화는 비활성화되어 있습니다. (DB_SYNC=true로 활성화 가능)"
      );
    }
  } catch (error) {
    console.error("❌ 데이터베이스 연결 실패:", error);
    process.exit(1);
  }
}
