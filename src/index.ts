import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";

import { connectDatabase } from "./config/database";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";

// 환경 변수 로드
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 미들웨어 설정
app.use(
  helmet({
    contentSecurityPolicy: false, // 테스트 페이지를 위해 CSP 비활성화
  })
);
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙 (테스트 페이지)
app.use("/test", express.static(path.join(__dirname, "../public/test")));

// 라우트 설정
app.use("/api", routes);

// 에러 핸들러
app.use(errorHandler);

// 서버 시작
async function startServer(): Promise<void> {
  try {
    // 데이터베이스 연결
    await connectDatabase();

    app.listen(port, () => {
      console.log(`🚀 서버가 포트 ${port}에서 실행 중입니다.`);
      console.log(`📍 API: http://localhost:${port}/api/v1`);
      console.log(`❤️  Health: http://localhost:${port}/api/v1/health`);
      console.log(
        `🔐 카카오 로그인 테스트: http://localhost:${port}/test/kakao-login.html`
      );
    });
  } catch (error) {
    console.error("❌ 서버 시작 실패:", error);
    process.exit(1);
  }
}

startServer();
