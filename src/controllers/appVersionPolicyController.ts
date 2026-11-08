import type { Request, Response } from "express";
import { getAppVersionPolicy, type AppPlatform } from "../services/appVersionPolicyService";
import { logError } from "../utils/logger";

export function getVersionPolicy(req: Request, res: Response): void {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: getAppVersionPolicy(req.query.platform as AppPlatform) });
  } catch (error) {
    logError("app_version_policy_failed", error, req.request_id);
    res.status(503).json({
      success: false,
      error: { code: "APP_VERSION_POLICY_UNAVAILABLE", message: "업데이트 정보를 확인하지 못했습니다." },
      request_id: req.request_id,
    });
  }
}
