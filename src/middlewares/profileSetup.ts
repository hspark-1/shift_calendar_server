import { NextFunction, Request, Response } from "express";
import { authMiddleware } from "./auth";

// Mounted after public/auth routes and before every business router.
export function requireProfileSetupMiddleware(req: Request, res: Response, next: NextFunction): void {
  void authMiddleware(req, res, () => {
    if (req.user?.profile_completed_at == null) {
      res.status(400).json({ success: false, error: { code: "PROFILE_SETUP_REQUIRED", message: "가입 프로필을 먼저 완료해주세요." }, request_id: req.request_id });
      return;
    }
    next();
  });
}
