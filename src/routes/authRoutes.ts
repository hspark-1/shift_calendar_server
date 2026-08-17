import { NextFunction, Request, Response, Router } from "express";
import { body } from "express-validator";
import {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  getProfile,
  updateProfile,
  kakaoLogin,
  kakaoLoginWithToken,
  naverLogin,
  naverLoginWithToken,
  createAppleChallenge,
  appleCallback,
  appleLogin,
  googleLoginWithToken,
  deleteAccount,
  accountDeletionStatus,
} from "../controllers/authController";
import {
  accountDeletionStatusAuthMiddleware,
  authMiddleware,
} from "../middlewares/auth";
import { authRateLimitMiddleware } from "../middlewares/rateLimit";
import { validateRequestMiddleware } from "../middlewares/validateRequest";
import { normalizePhoneNumber } from "../utils/phone";

const router = Router();

function validateApplePlatform(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.body.platform === "ios" || req.body.platform === "android") {
    next();
    return;
  }

  res.status(400).json({
    success: false,
    error: {
      code: "APPLE_INVALID_PLATFORM",
      message: "platform은 ios 또는 android여야 합니다.",
    },
    request_id: req.request_id,
  });
}

function validateAccountDeletionConfirmation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.body?.confirmation === true) {
    next();
    return;
  }
  res.status(400).json({
    success: false,
    error: {
      code: "ACCOUNT_DELETION_CONFIRMATION_REQUIRED",
      message: "회원 탈퇴 확인이 필요합니다.",
    },
    request_id: req.request_id,
  });
}

function validateAppleCallbackState(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    typeof req.body.state === "string" &&
    /^[A-Za-z0-9_-]{43,128}$/.test(req.body.state)
  ) {
    next();
    return;
  }

  res.status(400).json({
    success: false,
    error: {
      code: "APPLE_INVALID_CHALLENGE",
      message: "Apple 로그인 요청이 만료되었습니다. 다시 시도해주세요.",
    },
    request_id: req.request_id,
  });
}

function validateAppleLoginChallengeFields(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const credential_pattern = /^[A-Za-z0-9_-]{43,128}$/;
  if (
    typeof req.body.state === "string" &&
    credential_pattern.test(req.body.state) &&
    typeof req.body.nonce === "string" &&
    credential_pattern.test(req.body.nonce)
  ) {
    next();
    return;
  }

  res.status(400).json({
    success: false,
    error: {
      code: "APPLE_INVALID_CHALLENGE",
      message: "Apple 로그인 요청이 만료되었습니다. 다시 시도해주세요.",
    },
    request_id: req.request_id,
  });
}

// ===== OAuth 로그인 =====

// Google SDK ID Token 서버 검증 로그인
router.post(
  "/google/token",
  authRateLimitMiddleware,
  [
    body("id_token")
      .isString()
      .withMessage("id_token은 문자열이어야 합니다.")
      .bail()
      .customSanitizer((value: string) => value.trim())
      .isLength({ min: 1, max: 16384 })
      .withMessage("id_token은 trim 후 1~16384자여야 합니다."),
  ],
  validateRequestMiddleware,
  googleLoginWithToken,
);

// Apple OAuth 로그인 challenge 발급
router.post(
  "/apple/challenge",
  authRateLimitMiddleware,
  validateApplePlatform,
  createAppleChallenge,
);

// Apple Android/Web form_post callback (고정 intent로만 전달)
router.post(
  "/apple/callback",
  authRateLimitMiddleware,
  validateAppleCallbackState,
  [
    body("code").optional().isString().isLength({ min: 1, max: 4096 }),
    body("id_token")
      .optional()
      .isString()
      .isLength({ min: 1, max: 16384 }),
    body("user").optional().isString().isLength({ min: 1, max: 8192 }),
    body("error").optional().isString().isLength({ min: 1, max: 128 }),
  ],
  validateRequestMiddleware,
  appleCallback,
);

// Apple OAuth 로그인 완료
router.post(
  "/apple",
  authRateLimitMiddleware,
  validateApplePlatform,
  validateAppleLoginChallengeFields,
  [
    body("authorization_code")
      .isString()
      .isLength({ min: 1, max: 4096 })
      .withMessage("유효한 authorization_code가 필요합니다."),
    body("identity_token")
      .optional()
      .isString()
      .isLength({ min: 1, max: 16384 })
      .withMessage("identity_token 형식이 올바르지 않습니다."),
    body("given_name")
      .optional()
      .isString()
      .customSanitizer((value: string) => value.trim())
      .isLength({ min: 1, max: 100 })
      .withMessage("given_name은 trim 후 1~100자여야 합니다."),
    body("family_name")
      .optional()
      .isString()
      .customSanitizer((value: string) => value.trim())
      .isLength({ min: 1, max: 100 })
      .withMessage("family_name은 trim 후 1~100자여야 합니다."),
  ],
  validateRequestMiddleware,
  appleLogin,
);

// 카카오 OAuth 로그인 (WebView 방식 - authorization code)
router.post(
  "/kakao",
  authRateLimitMiddleware,
  [
    body("code")
      .isString()
      .notEmpty()
      .withMessage("Authorization code가 필요합니다."),
    body("redirect_uri")
      .isString()
      .notEmpty()
      .withMessage("redirect_uri가 필요합니다."),
  ],
  validateRequestMiddleware,
  kakaoLogin
);

// 카카오 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
router.post(
  "/kakao/token",
  authRateLimitMiddleware,
  [
    body("access_token")
      .isString()
      .isLength({ min: 1, max: 4096 })
      .matches(/^\S+$/)
      .withMessage("access_token 형식이 올바르지 않습니다."),
  ],
  validateRequestMiddleware,
  kakaoLoginWithToken
);

// 네이버 OAuth 로그인 (WebView 방식 - authorization code)
router.post(
  "/naver",
  authRateLimitMiddleware,
  [
    body("code")
      .isString()
      .notEmpty()
      .withMessage("Authorization code가 필요합니다."),
    body("redirect_uri")
      .isString()
      .notEmpty()
      .withMessage("redirect_uri가 필요합니다."),
    body("state").optional().isString(),
  ],
  validateRequestMiddleware,
  naverLogin
);

// 네이버 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
router.post(
  "/naver/token",
  authRateLimitMiddleware,
  [
    body("access_token")
      .isString()
      .notEmpty()
      .withMessage("access_token이 필요합니다."),
  ],
  validateRequestMiddleware,
  naverLoginWithToken
);

// ===== 패스워드 인증 (추후 활성화) =====

// 회원가입
router.post(
  "/register",
  authRateLimitMiddleware,
  [
    body("email").isEmail().withMessage("유효한 이메일을 입력하세요."),
    body("password")
      .isString()
      .isLength({ min: 6 })
      .withMessage("비밀번호는 최소 6자 이상이어야 합니다."),
    body("name").notEmpty().withMessage("이름을 입력하세요."),
  ],
  validateRequestMiddleware,
  register
);

// 로그인
router.post(
  "/login",
  authRateLimitMiddleware,
  [
    body("email").isEmail().withMessage("유효한 이메일을 입력하세요."),
    body("password")
      .isString()
      .notEmpty()
      .withMessage("비밀번호를 입력하세요."),
  ],
  validateRequestMiddleware,
  login
);

// ===== 공통 =====

// 토큰 갱신
router.post(
  "/refresh",
  authRateLimitMiddleware,
  [
    body("refresh_token")
      .isString()
      .notEmpty()
      .withMessage("Refresh 토큰이 필요합니다."),
  ],
  validateRequestMiddleware,
  refreshToken
);

// 로그아웃 (현재 기기)
router.post(
  "/logout",
  [
    body("refresh_token")
      .isString()
      .notEmpty()
      .withMessage("Refresh 토큰이 필요합니다."),
    body("installation_id")
      .optional()
      .isUUID()
      .withMessage("installation_id는 UUID여야 합니다."),
  ],
  validateRequestMiddleware,
  logout
);

// 로그아웃 (모든 기기) - 인증 필요
router.post("/logout-all", authMiddleware, logoutAll);

// 내 정보 조회
router.get("/profile", authMiddleware, getProfile);

// 내 정보 수정
router.post(
  "/profile",
  authMiddleware,
  [
    body("name")
      .optional()
      .isString()
      .withMessage("이름은 문자열이어야 합니다."),
    body("timezone")
      .optional()
      .isString()
      .withMessage("타임존은 문자열이어야 합니다."),
    body("profile_image_url")
      .optional()
      .isString()
      .withMessage("프로필 이미지 URL은 문자열이어야 합니다."),
    body("phone")
      .optional()
      .isString()
      .withMessage("전화번호는 문자열이어야 합니다.")
      .bail()
      .custom((phone) => normalizePhoneNumber(phone) !== null)
      .withMessage(
        "전화번호는 10~11자리 숫자 또는 000-000-0000/000-0000-0000 형식이어야 합니다."
      )
      .customSanitizer((phone) => normalizePhoneNumber(phone)),
  ],
  validateRequestMiddleware,
  updateProfile
);

router.delete(
  "/account",
  authRateLimitMiddleware,
  authMiddleware,
  validateAccountDeletionConfirmation,
  deleteAccount,
);

router.get(
  "/account-deletion",
  accountDeletionStatusAuthMiddleware,
  accountDeletionStatus,
);

export default router;
