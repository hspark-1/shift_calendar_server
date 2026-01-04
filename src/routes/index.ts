import { Router } from "express";
import authRoutes from "./authRoutes";
import scheduleRoutes from "./scheduleRoutes";
import calendarRoutes from "./calendarRoutes";

const router = Router();

// v1 API 라우터
const v1_router = Router();

v1_router.use("/auth", authRoutes);
v1_router.use("/schedules", scheduleRoutes);
v1_router.use("/", calendarRoutes);

// 헬스 체크
v1_router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    version: "v1",
    timestamp: new Date().toISOString(),
  });
});

// v1 라우터 등록
router.use("/v1", v1_router);

export default router;
