import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { User } from "../models";
import {
  generateTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "../services/authService";
import {
  KakaoAuthError,
  exchangeKakaoToken,
  kakaoService,
} from "../services/kakaoService";
import {
  processNaverLogin,
  getNaverUserInfo,
  completeNaverLogin,
  NaverAuthError,
} from "../services/naverService";
import { ensureDefaultTemplate } from "../services/shiftTemplateService";
import {
  logAppleAuthEvent,
  logError,
  logGoogleAuthEvent,
  logKakaoAuthEvent,
} from "../utils/logger";
import {
  AppleAuthError,
  appleService,
} from "../services/appleService";
import { OAuthLoginPlatform } from "../models/OAuthLoginChallenge";
import {
  GoogleAuthError,
  googleService,
} from "../services/googleService";
import {
  AccountDeletionError,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from "../services/accountDeletionService";
import { ProfileError } from "../services/profileService";
import { mutateProfile } from "../services/profileMutationService";

// Express Request에 user 속성 추가 타입
interface AuthenticatedRequest extends Request {
  user?: User;
}

// 디바이스 정보 추출 헬퍼
function getDeviceInfo(req: Request): string {
  const user_agent = req.headers["user-agent"] || "unknown";
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${user_agent} | ${ip}`;
}

function sendAppleAuthError(
  req: Request,
  res: Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof AppleAuthError) {
    res.status(error.status_code).json({
      success: false,
      error: { code: error.code, message: error.message },
      request_id: req.request_id,
    });
    return;
  }

  logError(context, error, req.request_id);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다.",
    },
    request_id: req.request_id,
  });
}

function sendGoogleAuthError(
  req: Request,
  res: Response,
  error: unknown,
): void {
  if (error instanceof GoogleAuthError) {
    res.status(error.status_code).json({
      success: false,
      error: { code: error.code, message: error.message },
      request_id: req.request_id,
    });
    return;
  }

  logError("auth_google_login_failed", error, req.request_id);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다.",
    },
    request_id: req.request_id,
  });
}

function sendKakaoAuthError(
  req: Request,
  res: Response,
  error: unknown,
  started_at: number,
): void {
  if (error instanceof KakaoAuthError) {
    logKakaoAuthEvent({
      request_id: req.request_id,
      action: "token_login",
      result: error.status_code >= 500 ? "error" : "denied",
      error_code: error.code,
      duration_ms: Date.now() - started_at,
    });
    res.status(error.status_code).json({
      success: false,
      error: { code: error.code, message: error.message },
      request_id: req.request_id,
    });
    return;
  }

  logKakaoAuthEvent({
    request_id: req.request_id,
    action: "token_login",
    result: "error",
    error_code: "INTERNAL_SERVER_ERROR",
    duration_ms: Date.now() - started_at,
  });
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다.",
    },
    request_id: req.request_id,
  });
}

function sendProfileError(
  req: Request,
  res: Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof ProfileError) {
    res.status(error.status_code).json({
      success: false,
      error: { code: error.code, message: error.message },
      request_id: req.request_id,
    });
    return;
  }
  logError(context, error, req.request_id);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다.",
    },
    request_id: req.request_id,
  });
}

export async function googleLoginWithToken(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  try {
    const result = await googleService.completeLogin({
      id_token: req.body.id_token,
      access_token: req.body.access_token,
      device_info: getDeviceInfo(req),
    });
    logGoogleAuthEvent({
      request_id: req.request_id,
      user_id: result.user.user_id,
      result: "success",
      duration_ms: Date.now() - started_at,
      is_new_user: result.is_new_user,
    });
    res.status(result.is_new_user ? 201 : 200).json({
      success: true,
      message: result.is_new_user
        ? "회원가입이 완료되었습니다."
        : "Google 로그인 성공",
      data: {
        user: result.user.toJSON(),
        ...result.tokens,
        is_new_user: result.is_new_user,
        requires_profile_setup: result.user.profile_completed_at == null,
      },
    });
  } catch (error) {
    const error_code =
      error instanceof GoogleAuthError
        ? error.code
        : "INTERNAL_SERVER_ERROR";
    logGoogleAuthEvent({
      request_id: req.request_id,
      result:
        error_code === "GOOGLE_UPSTREAM_UNAVAILABLE" ||
        error_code === "INTERNAL_SERVER_ERROR"
          ? "error"
          : "denied",
      error_code,
      duration_ms: Date.now() - started_at,
    });
    sendGoogleAuthError(req, res, error);
  }
}

export async function createAppleChallenge(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  const platform = req.body.platform as OAuthLoginPlatform;
  try {
    const challenge = await appleService.createChallenge(platform);
    logAppleAuthEvent({
      request_id: req.request_id,
      platform,
      action: "challenge",
      result: "success",
      duration_ms: Date.now() - started_at,
    });
    res.json({ success: true, data: challenge });
  } catch (error) {
    logAppleAuthEvent({
      request_id: req.request_id,
      platform,
      action: "challenge",
      result: error instanceof AppleAuthError ? "denied" : "error",
      error_code:
        error instanceof AppleAuthError ? error.code : "INTERNAL_SERVER_ERROR",
      duration_ms: Date.now() - started_at,
    });
    sendAppleAuthError(req, res, error, "auth_apple_challenge_failed");
  }
}

export async function appleCallback(
  req: Request,
  res: Response,
): Promise<void> {
  const started_at = Date.now();
  try {
    const redirect_url = await appleService.buildAndroidCallbackRedirect(
      req.body as Record<string, unknown>,
    );
    logAppleAuthEvent({
      request_id: req.request_id,
      platform: "android",
      action: "callback",
      result: "success",
      duration_ms: Date.now() - started_at,
    });
    res.redirect(303, redirect_url);
  } catch (error) {
    logAppleAuthEvent({
      request_id: req.request_id,
      platform: "android",
      action: "callback",
      result: error instanceof AppleAuthError ? "denied" : "error",
      error_code:
        error instanceof AppleAuthError ? error.code : "INTERNAL_SERVER_ERROR",
      duration_ms: Date.now() - started_at,
    });
    sendAppleAuthError(req, res, error, "auth_apple_callback_failed");
  }
}

export async function appleLogin(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  const platform = req.body.platform as OAuthLoginPlatform;
  try {
    const result = await appleService.completeLogin({
      platform,
      authorization_code: req.body.authorization_code,
      identity_token: req.body.identity_token,
      state: req.body.state,
      nonce: req.body.nonce,
      given_name: req.body.given_name,
      family_name: req.body.family_name,
      device_info: getDeviceInfo(req),
    });
    logAppleAuthEvent({
      request_id: req.request_id,
      platform,
      user_id: result.user.user_id,
      action: "login",
      result: "success",
      duration_ms: Date.now() - started_at,
    });
    res.json({
      success: true,
      message: result.is_new_user
        ? "회원가입이 완료되었습니다."
        : "로그인 성공",
      data: {
        user: result.user.toJSON(),
        ...result.tokens,
        is_new_user: result.is_new_user,
        requires_profile_setup: result.user.profile_completed_at == null,
      },
    });
  } catch (error) {
    logAppleAuthEvent({
      request_id: req.request_id,
      platform,
      action: "login",
      result: error instanceof AppleAuthError ? "denied" : "error",
      error_code:
        error instanceof AppleAuthError ? error.code : "INTERNAL_SERVER_ERROR",
      duration_ms: Date.now() - started_at,
    });
    sendAppleAuthError(req, res, error, "auth_apple_login_failed");
  }
}

// 회원가입 (패스워드 인증 - 추후 활성화)
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, password, name, timezone } = req.body;

    // 이메일 중복 확인
    const existing_user = await User.findOne({ where: { email } });
    if (existing_user) {
      res
        .status(400)
        .json({ success: false, message: "이미 등록된 이메일입니다." });
      return;
    }

    // 사용자 생성
    const user = await User.create({
      email,
      password,
      name,
      timezone,
    });

    // 신규 사용자 기본 근무 템플릿 생성
    await ensureDefaultTemplate(user.user_id);

    // 토큰 생성 (DB에 refresh_token 저장)
    const device_info = getDeviceInfo(req);
    const tokens = await generateTokens(user, { device_info });

    res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      data: {
        user: user.toJSON(),
        ...tokens,
        requires_profile_setup: user.profile_completed_at == null,
      },
    });
  } catch (error) {
    logError("auth_register_failed", error, req.request_id);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 로그인 (패스워드 인증 - 추후 활성화)
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, errors: errors.array() });
      return;
    }

    const { email, password } = req.body;

    // 사용자 조회
    const user = await User.findOne({ where: { email } });
    if (!user) {
      res.status(401).json({
        success: false,
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
      return;
    }

    // 비밀번호 검증
    const is_valid_password = await user.validatePassword(password);
    if (!is_valid_password) {
      res.status(401).json({
        success: false,
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
      return;
    }

    // 토큰 생성 (DB에 refresh_token 저장)
    const device_info = getDeviceInfo(req);
    const tokens = await generateTokens(user, { device_info });

    res.json({
      success: true,
      message: "로그인 성공",
      data: {
        user: user.toJSON(),
        ...tokens,
        requires_profile_setup: user.profile_completed_at == null,
      },
    });
  } catch (error) {
    logError("auth_login_failed", error, req.request_id);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 토큰 갱신 (Token Rotation 적용)
export async function refreshToken(req: Request, res: Response): Promise<void> {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      res
        .status(400)
        .json({ success: false, message: "Refresh 토큰이 필요합니다." });
      return;
    }

    const device_info = getDeviceInfo(req);
    const result = await rotateRefreshToken(refresh_token, device_info);

    if (!result) {
      res
        .status(401)
        .json({ success: false, message: "유효하지 않은 Refresh 토큰입니다." });
      return;
    }

    res.json({
      success: true,
      data: result.tokens,
    });
  } catch (error) {
    logError("auth_refresh_failed", error, req.request_id);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 로그아웃 (현재 기기)
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const { refresh_token, installation_id } = req.body;

    if (!refresh_token) {
      res
        .status(400)
        .json({ success: false, message: "Refresh 토큰이 필요합니다." });
      return;
    }

    const revoked = await revokeRefreshToken(refresh_token, installation_id);

    if (!revoked) {
      // 이미 무효화된 토큰이거나 존재하지 않는 경우에도 성공으로 처리
      // (클라이언트 입장에서는 로그아웃 완료)
      res.json({
        success: true,
        message: "로그아웃 되었습니다.",
      });
      return;
    }

    res.json({
      success: true,
      message: "로그아웃 되었습니다.",
    });
  } catch (error) {
    logError("auth_logout_failed", error, req.request_id);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 로그아웃 (모든 기기)
export async function logoutAll(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "인증이 필요합니다." });
      return;
    }

    const revoked_count = await revokeAllUserTokens(req.user.user_id);

    res.json({
      success: true,
      message: `모든 기기에서 로그아웃 되었습니다. (${revoked_count}개 세션)`,
    });
  } catch (error) {
    logError("auth_logout_all_failed", error, req.request_id);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 내 정보 조회
export async function getProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    res.json({
      success: true,
      data: req.user?.toJSON(),
      request_id: req.request_id,
    });
  } catch (error) {
    logError("auth_profile_get_failed", error, req.request_id);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 내 정보 수정
export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "인증이 필요합니다." },
        request_id: req.request_id,
      });
      return;
    }
    const user = await mutateProfile(req.user.user_id, req.body, req.validated_profile_image, false, req.request_id);

    res.json({
      success: true,
      message: "프로필이 수정되었습니다.",
      data: user.toJSON(),
      request_id: req.request_id,
    });
  } catch (error) {
    sendProfileError(req, res, error, "auth_profile_update_failed");
  }
}

export async function completeProfile(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "인증이 필요합니다." },
      request_id: req.request_id,
    });
    return;
  }

  try {
    const user = await mutateProfile(req.user.user_id, req.body, req.validated_profile_image, true, req.request_id);
    res.status(200).json({
      success: true,
      data: user.toJSON(),
      request_id: req.request_id,
    });
  } catch (error) {
    sendProfileError(req, res, error, "auth_profile_complete_failed");
  }
}

function sendAccountDeletionError(
  req: Request,
  res: Response,
  error: unknown,
): void {
  if (error instanceof AccountDeletionError) {
    res.status(error.status_code).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "REAUTHENTICATION_REQUIRED"
            ? "회원 탈퇴를 위해 다시 로그인해주세요."
            : error.code === "ACCOUNT_DELETION_IN_PROGRESS"
              ? "회원 탈퇴가 이미 처리 중입니다."
              : error.code === "ACCOUNT_DELETION_DISABLED"
                ? "회원 탈퇴 기능이 현재 비활성화되어 있습니다."
                : "회원 탈퇴 요청을 찾을 수 없습니다.",
      },
      ...(error.deletion_request_id && {
        data: { deletion_request_id: error.deletion_request_id },
      }),
      request_id: req.request_id,
    });
    return;
  }
  logError("account_deletion_request_failed", error, req.request_id);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다.",
    },
    request_id: req.request_id,
  });
}

export async function deleteAccount(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "인증이 필요합니다." });
      return;
    }
    const receipt = await requestAccountDeletion(
      req.user.user_id,
      req.auth_context?.auth_time ?? null,
    );
    res.status(202).json({
      success: true,
      data: receipt,
      request_id: req.request_id,
    });
  } catch (error) {
    sendAccountDeletionError(req, res, error);
  }
}

export async function accountDeletionStatus(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "인증이 필요합니다." });
      return;
    }
    const status = await getAccountDeletionStatus(req.user.user_id);
    res.json({ success: true, data: status, request_id: req.request_id });
  } catch (error) {
    sendAccountDeletionError(req, res, error);
  }
}

// 카카오 OAuth 로그인
export async function kakaoLogin(req: Request, res: Response): Promise<void> {
  const started_at = Date.now();
  logKakaoAuthEvent({
    request_id: req.request_id,
    action: "legacy_route_access",
    result: "success",
    duration_ms: 0,
  });
  try {
    const { code, redirect_uri } = req.body;

    if (!code) {
      res
        .status(400)
        .json({ success: false, message: "Authorization code가 필요합니다." });
      return;
    }

    if (!redirect_uri) {
      res
        .status(400)
        .json({ success: false, message: "redirect_uri가 필요합니다." });
      return;
    }

    const access_token = await exchangeKakaoToken(code, redirect_uri);
    const result = await kakaoService.completeLogin({
      access_token,
      device_info: getDeviceInfo(req),
    });

    res.json({
      success: true,
      message: result.is_new_user
        ? "회원가입이 완료되었습니다."
        : "로그인 성공",
      data: {
        user: result.user.toJSON(),
        ...result.tokens,
        is_new_user: result.is_new_user,
        requires_profile_setup: result.user.profile_completed_at == null,
      },
      request_id: req.request_id,
    });
  } catch (error) {
    sendKakaoAuthError(req, res, error, started_at);
  }
}

// 카카오 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
export async function kakaoLoginWithToken(
  req: Request,
  res: Response
): Promise<void> {
  const started_at = Date.now();
  try {
    const result = await kakaoService.completeLogin({
      access_token: req.body.access_token,
      device_info: getDeviceInfo(req),
    });

    logKakaoAuthEvent({
      request_id: req.request_id,
      user_id: result.user.user_id,
      action: "token_login",
      result: "success",
      duration_ms: Date.now() - started_at,
      is_new_user: result.is_new_user,
    });

    res.json({
      success: true,
      message: result.is_new_user
        ? "회원가입이 완료되었습니다."
        : "로그인 성공",
      data: {
        user: result.user.toJSON(),
        ...result.tokens,
        is_new_user: result.is_new_user,
        requires_profile_setup: result.user.profile_completed_at == null,
      },
      request_id: req.request_id,
    });
  } catch (error) {
    sendKakaoAuthError(req, res, error, started_at);
  }
}

function sendNaverAuthError(req: Request, res: Response, error: unknown): void {
  logError("auth_naver_login_failed", error, req.request_id);
  const known_error = error instanceof NaverAuthError;
  const message = known_error ? error.message : "네이버 로그인 처리 중 오류가 발생했습니다.";
  res.status(known_error ? error.status_code : 500).json({
    success: false,
    message,
    error: { code: known_error ? error.code : "INTERNAL_SERVER_ERROR", message },
    request_id: req.request_id,
  });
}

// 두 진입점은 외부 인증 뒤 동일한 사용자 저장/세션 발급 정책을 적용한다.
async function sendNaverLoginResponse(
  req: Request,
  res: Response,
  identity: Awaited<ReturnType<typeof getNaverUserInfo>>,
): Promise<void> {
  const result = await completeNaverLogin(identity, getDeviceInfo(req));
  res.json({
    success: true,
    message: result.is_new_user ? "회원가입이 완료되었습니다." : "로그인 성공",
    data: {
      user: result.user.toJSON(),
      ...result.tokens,
      requires_profile_setup: result.user.profile_completed_at == null,
    },
    request_id: req.request_id,
  });
}

// 네이버 OAuth 로그인 (Authorization Code)
export async function naverLogin(req: Request, res: Response): Promise<void> {
  try {
    const { code, state, redirect_uri } = req.body;
    if (!code || !redirect_uri) {
      throw new NaverAuthError("VALIDATION_ERROR", 400, "Authorization code와 redirect_uri가 필요합니다.");
    }
    const identity = await processNaverLogin(code, state, redirect_uri);
    await sendNaverLoginResponse(req, res, identity);
  } catch (error) {
    sendNaverAuthError(req, res, error);
  }
}

// 네이버 OAuth 로그인 (SDK Access Token)
export async function naverLoginWithToken(req: Request, res: Response): Promise<void> {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      throw new NaverAuthError("VALIDATION_ERROR", 400, "access_token이 필요합니다.");
    }
    const identity = await getNaverUserInfo(access_token);
    await sendNaverLoginResponse(req, res, identity);
  } catch (error) {
    sendNaverAuthError(req, res, error);
  }
}
