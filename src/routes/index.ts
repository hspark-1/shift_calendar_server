import { Request, Response, Router } from "express";
import authRoutes from "./authRoutes";
import scheduleRoutes from "./scheduleRoutes";
import calendarRoutes from "./calendarRoutes";
import friendRoutes from "./friendRoutes";
import { checkDatabaseConnection } from "../config/database";

const router = Router();

// v1 API 라우터
const v1_router = Router();

function sendLivenessResponse(_req: Request, res: Response): void {
  res.json({
    success: true,
    message: "Server is running",
    version: "v1",
    timestamp: new Date().toISOString(),
  });
}

// 기존 경로 호환용 liveness와 명시적 liveness
v1_router.get("/health", sendLivenessResponse);
v1_router.get("/health/live", sendLivenessResponse);

// 컨테이너/Nginx upstream 등록 판단용 readiness
v1_router.get("/health/ready", async (_req, res) => {
  try {
    await checkDatabaseConnection();
    res.json({
      success: true,
      message: "Server and database are ready",
      version: "v1",
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      success: false,
      message: "Database is not ready",
    });
  }
});

v1_router.use("/auth", authRoutes);
v1_router.use("/schedules", scheduleRoutes);
v1_router.use("/", calendarRoutes);
v1_router.use("/", friendRoutes); // 친구 관련 라우트

// v1 라우터 등록
router.use("/v1", v1_router);

export default router;
