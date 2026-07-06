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

// CORS 설정 (Flutter 앱 접속용)
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    // 개발 환경: localhost 허용
    const allowedOrigins = [
      "https://shift-calendar.co.kr",
      "http://localhost",
      "http://localhost:3000",
      "http://localhost:8080",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:8080",
    ];

    // origin이 없으면 (모바일 앱 등) 허용
    if (!origin) {
      return callback(null, true);
    }

    // 허용된 origin인지 확인
    if (allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      // 개발 환경에서는 모든 origin 허용 (필요 시 주석 해제)
      // callback(null, true);
      callback(new Error("CORS 정책에 의해 차단되었습니다."));
    }
  },
  credentials: true, // JWT 토큰 등 인증 정보 전송 허용
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Authorization"], // 클라이언트에서 읽을 수 있는 헤더
  maxAge: 86400, // preflight 요청 캐시 시간 (24시간)
};

app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  next();
});

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
