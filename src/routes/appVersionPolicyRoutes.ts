import { Router } from "express";
import { query } from "express-validator";
import { getVersionPolicy } from "../controllers/appVersionPolicyController";
import { validateRequestMiddleware } from "../middlewares/validateRequest";

const router = Router();

// 로그인 이전의 앱 진입 검사에 사용하므로 인증 미들웨어를 붙이지 않는다.
router.get(
  "/app/version-policy",
  query("platform").isString().isIn(["IOS", "ANDROID"])
    .withMessage("platform은 IOS 또는 ANDROID여야 합니다."),
  validateRequestMiddleware,
  getVersionPolicy,
);

export default router;
