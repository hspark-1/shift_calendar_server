import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import os from "os";
import type { Server } from "http";

import { connectDatabase, disconnectDatabase } from "./config/database";
import {
  getPositiveIntegerEnvironmentVariable,
  validateEnvironment,
} from "./config/environment";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";

const app = express();
const port = getPositiveIntegerEnvironmentVariable("PORT", 3000);
const node_env = process.env.NODE_ENV || "development";
const instance_id = process.env.INSTANCE_ID || os.hostname();
const trust_proxy_hops = getPositiveIntegerEnvironmentVariable(
  "TRUST_PROXY_HOPS",
  node_env === "production" ? 1 : 0,
  { allow_zero: true }
);
const shutdown_timeout_ms = getPositiveIntegerEnvironmentVariable(
  "SHUTDOWN_TIMEOUT_MS",
  10000
);
let http_server: Server | null = null;
let is_shutting_down = false;

if (trust_proxy_hops > 0) {
  app.set("trust proxy", trust_proxy_hops);
}

// 미들웨어 설정
app.use(
  helmet({
    contentSecurityPolicy: node_env === "development" ? false : undefined,
  })
);

// CORS 설정 (Flutter 앱 접속용)
const default_allowed_origins =
  node_env === "production"
    ? ["https://shift-calendar.co.kr"]
    : [
        "https://shift-calendar.co.kr",
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8080",
      ];
const configured_allowed_origins = process.env.CORS_ALLOWED_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const allowed_origins =
  configured_allowed_origins && configured_allowed_origins.length > 0
    ? configured_allowed_origins
    : default_allowed_origins;

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => {
    // origin이 없으면 (모바일 앱 등) 허용
    if (!origin) {
      return callback(null, true);
    }

    // scheme/host/port가 모두 정확히 일치하는 origin만 허용
    if (allowed_origins.includes(origin)) {
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
app.use(morgan(node_env === "production" ? "combined" : "dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  next();
});

// OAuth 수동 테스트 페이지는 개발 환경에서만 노출
if (node_env === "development") {
  app.use("/test", express.static(path.join(__dirname, "../public/test")));
}

// 라우트 설정
app.use("/api", routes);

// 에러 핸들러
app.use(errorHandler);

// 서버 시작
async function startServer(): Promise<void> {
  try {
    validateEnvironment();
    await connectDatabase();

    http_server = app.listen(port, () => {
      console.log(
        `🚀 서버가 포트 ${port}에서 실행 중입니다. instance_id=${instance_id}`
      );
      console.log(`📍 API: http://localhost:${port}/api/v1`);
      console.log(`❤️  Health: http://localhost:${port}/api/v1/health`);
      if (node_env === "development") {
        console.log(
          `🔐 카카오 로그인 테스트: http://localhost:${port}/test/kakao-login.html`
        );
      }
    });
  } catch (error) {
    console.error("❌ 서버 시작 실패:", error);
    process.exit(1);
  }
}

async function shutdownServer(signal: string): Promise<void> {
  if (is_shutting_down) return;
  is_shutting_down = true;
  console.log(`ℹ️  ${signal} 수신: 서버 종료를 시작합니다.`);

  const force_shutdown_timer = setTimeout(() => {
    console.error("❌ graceful shutdown 제한시간을 초과했습니다.");
    process.exit(1);
  }, shutdown_timeout_ms);
  force_shutdown_timer.unref();

  try {
    if (http_server) {
      await new Promise<void>((resolve, reject) => {
        http_server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    await disconnectDatabase();
    clearTimeout(force_shutdown_timer);
    console.log("✅ 서버와 데이터베이스 연결을 정상 종료했습니다.");
    process.exit(0);
  } catch (error) {
    clearTimeout(force_shutdown_timer);
    console.error("❌ 서버 종료 실패:", error);
    process.exit(1);
  }
}

process.once("SIGTERM", () => {
  void shutdownServer("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdownServer("SIGINT");
});

startServer();
