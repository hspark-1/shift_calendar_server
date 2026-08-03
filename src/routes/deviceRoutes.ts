import { Router } from "express";
import { body } from "express-validator";
import { putCurrentDevice } from "../controllers/deviceController";
import { authMiddleware } from "../middlewares/auth";
import { validateRequestMiddleware } from "../middlewares/validateRequest";

const router = Router();

router.put(
  "/devices/current",
  authMiddleware,
  [
    body("installation_id")
      .isUUID()
      .withMessage("installation_id는 UUID여야 합니다."),
    body("platform")
      .isIn(["ANDROID", "IOS"])
      .withMessage("platform은 ANDROID 또는 IOS여야 합니다."),
    body("provider_target")
      .optional({ nullable: true })
      .isString()
      .isLength({ min: 1, max: 4096 })
      .withMessage("provider_target은 1~4096자 문자열이어야 합니다."),
    body("push_permission_enabled")
      .isBoolean({ strict: true })
      .withMessage("push_permission_enabled는 boolean이어야 합니다."),
    body("app_version")
      .isString()
      .trim()
      .isLength({ min: 1, max: 64 })
      .withMessage("app_version은 1~64자 문자열이어야 합니다."),
  ],
  validateRequestMiddleware,
  putCurrentDevice,
);

export default router;
