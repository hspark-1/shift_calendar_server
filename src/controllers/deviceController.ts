import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { User } from "../models";
import { upsertCurrentDevice } from "../services/deviceService";
import { logError } from "../utils/logger";

interface AuthenticatedRequest extends Request {
  user?: User;
}

export async function putCurrentDevice(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "입력값 검증에 실패했습니다.",
        },
        errors: errors.array(),
      });
      return;
    }
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." },
      });
      return;
    }

    const device = await upsertCurrentDevice(req.user.user_id, {
      installation_id: req.body.installation_id,
      platform: req.body.platform,
      provider_target: req.body.provider_target ?? null,
      push_permission_enabled: req.body.push_permission_enabled,
      app_version: req.body.app_version,
    });

    res.json({
      success: true,
      data: {
        device_id: device.device_id,
        installation_id: device.installation_id,
        platform: device.platform,
        push_permission_enabled: device.push_permission_enabled,
        is_active: device.is_active,
        last_seen_at: device.last_seen_at.toISOString(),
      },
    });
  } catch (error) {
    logError("device_upsert_failed", error, req.request_id);
    res.status(500).json({
      success: false,
      error: {
        code: "DEVICE_SYNC_FAILED",
        message: "기기 정보를 동기화하지 못했습니다.",
      },
    });
  }
}
