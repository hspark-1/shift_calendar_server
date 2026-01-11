import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { User } from "../models";
import {
  generateTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "../services/authService";
import { processKakaoLogin, getKakaoUserInfo } from "../services/kakaoService";
import { processNaverLogin, getNaverUserInfo } from "../services/naverService";
import { ensureDefaultTemplate } from "../services/shiftTemplateService";

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
      },
    });
  } catch (error) {
    console.error("Register error:", error);
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
      },
    });
  } catch (error) {
    console.error("Login error:", error);
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
    console.error("Refresh token error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 로그아웃 (현재 기기)
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      res
        .status(400)
        .json({ success: false, message: "Refresh 토큰이 필요합니다." });
      return;
    }

    const revoked = await revokeRefreshToken(refresh_token);

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
    console.error("Logout error:", error);
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
    console.error("Logout all error:", error);
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
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res
      .status(500)
      .json({ success: false, message: "서버 오류가 발생했습니다." });
  }
}

// 카카오 OAuth 로그인
export async function kakaoLogin(req: Request, res: Response): Promise<void> {
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

    // 카카오 OAuth 처리: code → token → 사용자 정보
    const kakao_user_info = await processKakaoLogin(code, redirect_uri);

    // 기존 사용자 조회 (kakao_id 기준)
    let user = await User.findOne({
      where: { kakao_id: kakao_user_info.kakao_id },
    });

    if (!user) {
      // 이메일로 기존 사용자 확인 (다른 OAuth로 가입된 경우)
      const existing_email_user = await User.findOne({
        where: { email: kakao_user_info.email },
      });

      if (existing_email_user) {
        // 기존 계정에 카카오 ID 연결
        existing_email_user.kakao_id = kakao_user_info.kakao_id;
        await existing_email_user.save();
        user = existing_email_user;
        console.log(`카카오 계정 연결: ${user.email}`);
        // 기존 사용자도 템플릿이 없으면 생성
        await ensureDefaultTemplate(user.user_id);
      } else {
        // 신규 사용자 생성
        user = await User.create({
          email: kakao_user_info.email,
          name: kakao_user_info.name,
          profile_image_url: kakao_user_info.profile_image_url,
          kakao_id: kakao_user_info.kakao_id,
          timezone: "Asia/Seoul", // 기본 타임존
        });
        console.log(`카카오 회원가입 성공: ${user.email}`);
        // 신규 사용자 기본 근무 템플릿 생성
        await ensureDefaultTemplate(user.user_id);
      }
    } else {
      console.log(`카카오 로그인 성공: ${user.email}`);
      // 기존 사용자도 템플릿이 없으면 생성 (마이그레이션용)
      await ensureDefaultTemplate(user.user_id);
    }

    // JWT 토큰 생성 (DB에 refresh_token 저장)
    const device_info = getDeviceInfo(req);
    const tokens = await generateTokens(user, { device_info });

    res.json({
      success: true,
      message:
        user.created_at && Date.now() - user.created_at.getTime() < 1000
          ? "회원가입이 완료되었습니다."
          : "로그인 성공",
      data: {
        user: user.toJSON(),
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Kakao login error:", error);

    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    res.status(500).json({
      success: false,
      message: "카카오 로그인 처리 중 오류가 발생했습니다.",
    });
  }
}

// 카카오 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
export async function kakaoLoginWithToken(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      res
        .status(400)
        .json({ success: false, message: "access_token이 필요합니다." });
      return;
    }

    // 카카오 access_token으로 사용자 정보 조회
    const kakao_user_info = await getKakaoUserInfo(access_token);

    // 기존 사용자 조회 (kakao_id 기준)
    let user = await User.findOne({
      where: { kakao_id: kakao_user_info.kakao_id },
    });

    if (!user) {
      // 이메일로 기존 사용자 확인 (다른 OAuth로 가입된 경우)
      const existing_email_user = await User.findOne({
        where: { email: kakao_user_info.email },
      });

      if (existing_email_user) {
        // 기존 계정에 카카오 ID 연결
        existing_email_user.kakao_id = kakao_user_info.kakao_id;
        await existing_email_user.save();
        user = existing_email_user;
        console.log(`카카오 계정 연결 (SDK): ${user.email}`);
        // 기존 사용자도 템플릿이 없으면 생성
        await ensureDefaultTemplate(user.user_id);
      } else {
        // 신규 사용자 생성
        user = await User.create({
          email: kakao_user_info.email,
          name: kakao_user_info.name,
          profile_image_url: kakao_user_info.profile_image_url,
          kakao_id: kakao_user_info.kakao_id,
          timezone: "Asia/Seoul", // 기본 타임존
        });
        console.log(`카카오 회원가입 성공 (SDK): ${user.email}`);
        // 신규 사용자 기본 근무 템플릿 생성
        await ensureDefaultTemplate(user.user_id);
      }
    } else {
      console.log(`카카오 로그인 성공 (SDK): ${user.email}`);
      // 기존 사용자도 템플릿이 없으면 생성 (마이그레이션용)
      await ensureDefaultTemplate(user.user_id);
    }

    // JWT 토큰 생성 (DB에 refresh_token 저장)
    const device_info = getDeviceInfo(req);
    const tokens = await generateTokens(user, { device_info });

    res.json({
      success: true,
      message:
        user.created_at && Date.now() - user.created_at.getTime() < 1000
          ? "회원가입이 완료되었습니다."
          : "로그인 성공",
      data: {
        user: user.toJSON(),
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Kakao login with token error:", error);

    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    res.status(500).json({
      success: false,
      message: "카카오 로그인 처리 중 오류가 발생했습니다.",
    });
  }
}

// 네이버 OAuth 로그인
export async function naverLogin(req: Request, res: Response): Promise<void> {
  try {
    const { code, state, redirect_uri } = req.body;

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

    // 네이버 OAuth 처리: code → token → 사용자 정보
    const naver_user_info = await processNaverLogin(code, state, redirect_uri);

    // 기존 사용자 조회 (naver_id 기준)
    let user = await User.findOne({
      where: { naver_id: naver_user_info.naver_id },
    });

    if (!user) {
      // 이메일로 기존 사용자 확인 (다른 OAuth로 가입된 경우)
      const existing_email_user = await User.findOne({
        where: { email: naver_user_info.email },
      });

      if (existing_email_user) {
        // 기존 계정에 네이버 ID 연결
        existing_email_user.naver_id = naver_user_info.naver_id;
        await existing_email_user.save();
        user = existing_email_user;
        console.log(`네이버 계정 연결: ${user.email}`);
        // 기존 사용자도 템플릿이 없으면 생성
        await ensureDefaultTemplate(user.user_id);
      } else {
        // 신규 사용자 생성
        user = await User.create({
          email: naver_user_info.email,
          name: naver_user_info.name,
          profile_image_url: naver_user_info.profile_image_url,
          naver_id: naver_user_info.naver_id,
          timezone: "Asia/Seoul", // 기본 타임존
        });
        console.log(`네이버 회원가입 성공: ${user.email}`);
        // 신규 사용자 기본 근무 템플릿 생성
        await ensureDefaultTemplate(user.user_id);
      }
    } else {
      console.log(`네이버 로그인 성공: ${user.email}`);
      // 기존 사용자도 템플릿이 없으면 생성 (마이그레이션용)
      await ensureDefaultTemplate(user.user_id);
    }

    // JWT 토큰 생성 (DB에 refresh_token 저장)
    const device_info = getDeviceInfo(req);
    const tokens = await generateTokens(user, { device_info });

    res.json({
      success: true,
      message:
        user.created_at && Date.now() - user.created_at.getTime() < 1000
          ? "회원가입이 완료되었습니다."
          : "로그인 성공",
      data: {
        user: user.toJSON(),
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Naver login error:", error);

    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    res.status(500).json({
      success: false,
      message: "네이버 로그인 처리 중 오류가 발생했습니다.",
    });
  }
}

// 네이버 OAuth 로그인 (SDK 방식 - access_token 직접 전송)
export async function naverLoginWithToken(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      res
        .status(400)
        .json({ success: false, message: "access_token이 필요합니다." });
      return;
    }

    // 네이버 access_token으로 사용자 정보 조회
    const naver_user_info = await getNaverUserInfo(access_token);

    // 기존 사용자 조회 (naver_id 기준)
    let user = await User.findOne({
      where: { naver_id: naver_user_info.naver_id },
    });

    if (!user) {
      // 이메일로 기존 사용자 확인 (다른 OAuth로 가입된 경우)
      const existing_email_user = await User.findOne({
        where: { email: naver_user_info.email },
      });

      if (existing_email_user) {
        // 기존 계정에 네이버 ID 연결
        existing_email_user.naver_id = naver_user_info.naver_id;
        await existing_email_user.save();
        user = existing_email_user;
        console.log(`네이버 계정 연결 (SDK): ${user.email}`);
        // 기존 사용자도 템플릿이 없으면 생성
        await ensureDefaultTemplate(user.user_id);
      } else {
        // 신규 사용자 생성
        user = await User.create({
          email: naver_user_info.email,
          name: naver_user_info.name,
          profile_image_url: naver_user_info.profile_image_url,
          naver_id: naver_user_info.naver_id,
          timezone: "Asia/Seoul", // 기본 타임존
        });
        console.log(`네이버 회원가입 성공 (SDK): ${user.email}`);
        // 신규 사용자 기본 근무 템플릿 생성
        await ensureDefaultTemplate(user.user_id);
      }
    } else {
      console.log(`네이버 로그인 성공 (SDK): ${user.email}`);
      // 기존 사용자도 템플릿이 없으면 생성 (마이그레이션용)
      await ensureDefaultTemplate(user.user_id);
    }

    // JWT 토큰 생성 (DB에 refresh_token 저장)
    const device_info = getDeviceInfo(req);
    const tokens = await generateTokens(user, { device_info });

    res.json({
      success: true,
      message:
        user.created_at && Date.now() - user.created_at.getTime() < 1000
          ? "회원가입이 완료되었습니다."
          : "로그인 성공",
      data: {
        user: user.toJSON(),
        ...tokens,
      },
    });
  } catch (error) {
    console.error("Naver login with token error:", error);

    if (error instanceof Error) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    res.status(500).json({
      success: false,
      message: "네이버 로그인 처리 중 오류가 발생했습니다.",
    });
  }
}
