import { Router } from "express";
import { body } from "express-validator";
import {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  getProfile,
  kakaoLogin,
  kakaoLoginWithToken,
} from "../controllers/authController";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// ===== OAuth 로그인 =====

// 카카오 OAuth 로그인 (WebView 방식 - authorization code)
router.post(
  "/kakao",
  [body("code").notEmpty().withMessage("Authorization code가 필요합니다.")],
  kakaoLogin
);

// 카카오 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
router.post(
  "/kakao/token",
  [body("access_token").notEmpty().withMessage("access_token이 필요합니다.")],
  kakaoLoginWithToken
);

// ===== 패스워드 인증 (추후 활성화) =====

// 회원가입
router.post(
  "/register",
  [
    body("email").isEmail().withMessage("유효한 이메일을 입력하세요."),
    body("password")
      .isLength({ min: 6 })
      .withMessage("비밀번호는 최소 6자 이상이어야 합니다."),
    body("name").notEmpty().withMessage("이름을 입력하세요."),
  ],
  register
);

// 로그인
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("유효한 이메일을 입력하세요."),
    body("password").notEmpty().withMessage("비밀번호를 입력하세요."),
  ],
  login
);

// ===== 공통 =====

// 토큰 갱신
router.post("/refresh", refreshToken);

// 로그아웃 (현재 기기)
router.post(
  "/logout",
  [body("refresh_token").notEmpty().withMessage("Refresh 토큰이 필요합니다.")],
  logout
);

// 로그아웃 (모든 기기) - 인증 필요
router.post("/logout-all", authMiddleware, logoutAll);

// 내 정보 조회
router.get("/profile", authMiddleware, getProfile);

export default router;
