import express, { Request } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import type { Server } from "http";

import { connectDatabase, disconnectDatabase } from "./config/database";
import {
  getPositiveIntegerEnvironmentVariable,
  validateAppleAuthEnvironment,
  validateEnvironment,
  validateKakaoAuthEnvironment,
  validateProfileImageStorageEnvironment,
} from "./config/environment";
import { requestContextMiddleware } from "./middlewares/requestContext";
import routes from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { logError } from "./utils/logger";
import { disconnectRedis } from "./config/redis";
import { registerApiDocs } from "./openapi";
import { appleService } from "./services/appleService";
import { googleService } from "./services/googleService";

const app = express();
const port = getPositiveIntegerEnvironmentVariable("PORT", 3000);
const node_env = process.env.NODE_ENV || "development";
const instance_name = process.env.INSTANCE_NAME ?? "unknown";
const request_body_limit = process.env.REQUEST_BODY_LIMIT || "100kb";
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
app.use(requestContextMiddleware);

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
  exposedHeaders: ["Authorization", "ETag"], // 클라이언트에서 읽을 수 있는 헤더
  maxAge: 86400, // preflight 요청 캐시 시간 (24시간)
};

app.use(cors(corsOptions));
morgan.token(
  "request-id",
  (req) => (req as Request).request_id || "-"
);
morgan.token("safe-path", (req) => {
  const request = req as Request;
  return request.originalUrl.split("?")[0] || "/";
});
const request_log_format =
  node_env === "production"
    ? ':remote-addr [:date[clf]] ":method :safe-path HTTP/:http-version" :status :res[content-length] :response-time ms request_id=:request-id'
    : ":method :safe-path :status :response-time ms - :res[content-length] request_id=:request-id";
app.use(morgan(request_log_format));
app.use(express.json({ limit: request_body_limit }));
app.use(
  express.urlencoded({
    extended: true,
    limit: request_body_limit,
  })
);

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    instance: instance_name,
  });
});

// OAuth 수동 테스트 페이지는 개발 환경에서만 노출
if (node_env === "development") {
  app.use("/test", express.static(path.join(__dirname, "../public/test")));
}

// 라우트 설정
registerApiDocs(app);
app.use("/api", routes);

// 에러 핸들러
app.use(errorHandler);

// 서버 시작
async function startServer(): Promise<void> {
  try {
    validateEnvironment();
    validateKakaoAuthEnvironment();
    validateProfileImageStorageEnvironment();
    // Apple private key는 API 프로세스에만 mount합니다. 공용 환경변수를 읽는
    // cache/push worker가 API 전용 secret을 요구하지 않도록 여기서 분리 검증합니다.
    validateAppleAuthEnvironment();
    appleService.initialize();
    googleService.initialize();
    await connectDatabase();

    http_server = app.listen(port, "0.0.0.0", () => {
      console.log(
        `🚀 서버가 0.0.0.0:${port}에서 실행 중입니다. instance=${instance_name}`
      );
      console.log(`📍 API: http://localhost:${port}/api/v1`);
      console.log(`❤️  Health: http://localhost:${port}/health`);
      if (node_env === "development") {
        console.log(
          `🔐 카카오 로그인 테스트: http://localhost:${port}/test/kakao-login.html`
        );
      }
    });
  } catch (error) {
    logError("server_start_failed", error);
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
    await disconnectRedis();
    await disconnectDatabase();
    clearTimeout(force_shutdown_timer);
    console.log("✅ 서버와 데이터베이스 연결을 정상 종료했습니다.");
    process.exit(0);
  } catch (error) {
    clearTimeout(force_shutdown_timer);
    logError("server_shutdown_failed", error);
    process.exit(1);
  }
}

export { app };

if (require.main === module) {
  process.once("SIGTERM", () => {
    void shutdownServer("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdownServer("SIGINT");
  });
  void startServer();
}
