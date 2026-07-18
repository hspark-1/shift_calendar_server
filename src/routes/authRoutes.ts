import { Router } from "express";
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
} from "../controllers/authController";
import { authMiddleware } from "../middlewares/auth";
import { authRateLimitMiddleware } from "../middlewares/rateLimit";
import { validateRequestMiddleware } from "../middlewares/validateRequest";
import { normalizePhoneNumber } from "../utils/phone";

const router = Router();

// ===== OAuth 로그인 =====

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
      .notEmpty()
      .withMessage("access_token이 필요합니다."),
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

export default router;
