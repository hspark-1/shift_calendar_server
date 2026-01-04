import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { Op } from "sequelize";
import { User, RefreshToken } from "../models";

interface TokenPayload {
  user_id: string; // UUID
  email: string;
}

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (밀리초)
}

interface GenerateTokensOptions {
  device_info?: string;
}

// 토큰을 SHA-256으로 해싱
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// 토큰 생성 및 DB 저장
export async function generateTokens(
  user: User,
  options?: GenerateTokensOptions
): Promise<AuthTokens> {
  const jwt_secret = process.env.JWT_SECRET || "default_secret";
  const jwt_refresh_secret =
    process.env.JWT_REFRESH_SECRET || "default_refresh_secret";

  const payload: TokenPayload = {
    user_id: user.user_id,
    email: user.email,
  };

  const access_token_options: SignOptions = {
    expiresIn: "7d",
  };

  const refresh_token_options: SignOptions = {
    expiresIn: "30d",
  };

  const access_token = jwt.sign(payload, jwt_secret, access_token_options);
  const refresh_token = jwt.sign(
    payload,
    jwt_refresh_secret,
    refresh_token_options
  );

  // refresh_token 만료 시간 계산 (30일 후)
  const refresh_expires_at = new Date();
  refresh_expires_at.setDate(refresh_expires_at.getDate() + 30);

  // refresh_token을 DB에 저장 (해시값으로)
  const token_hash = hashToken(refresh_token);
  await RefreshToken.create({
    user_id: user.user_id,
    token_hash,
    device_info: options?.device_info || null,
    expires_at: refresh_expires_at,
  });

  // access_token 만료 시간 계산 (7일 후) - Unix timestamp (밀리초)로 반환
  const access_expires_at = new Date();
  access_expires_at.setDate(access_expires_at.getDate() + 7);

  return {
    access_token,
    refresh_token,
    expires_at: access_expires_at.getTime(),
  };
}

// refresh_token JWT 페이로드 검증 (서명만 확인)
export function verifyRefreshTokenJwt(token: string): TokenPayload | null {
  try {
    const jwt_refresh_secret =
      process.env.JWT_REFRESH_SECRET || "default_refresh_secret";
    return jwt.verify(token, jwt_refresh_secret) as TokenPayload;
  } catch {
    return null;
  }
}

// refresh_token DB 검증 및 조회
export async function findValidRefreshToken(
  token: string
): Promise<RefreshToken | null> {
  const token_hash = hashToken(token);

  const stored_token = await RefreshToken.findOne({
    where: {
      token_hash,
      revoked_at: null,
    },
  });

  if (!stored_token) return null;
  if (!stored_token.isValid()) return null;

  return stored_token;
}

// refresh_token 검증 + 기존 토큰 무효화 + 새 토큰 발급 (Token Rotation)
export async function rotateRefreshToken(
  old_refresh_token: string,
  device_info?: string
): Promise<{ tokens: AuthTokens; user: User } | null> {
  // 1. JWT 서명 검증
  const payload = verifyRefreshTokenJwt(old_refresh_token);
  if (!payload) return null;

  // 2. DB에서 토큰 유효성 확인
  const stored_token = await findValidRefreshToken(old_refresh_token);
  if (!stored_token) return null;

  // 3. 사용자 조회
  const user = await User.findByPk(payload.user_id);
  if (!user) return null;

  // 4. 기존 토큰 무효화 (Token Rotation)
  await stored_token.revoke();

  // 5. 새 토큰 발급
  const tokens = await generateTokens(user, { device_info });

  return { tokens, user };
}

// 단일 refresh_token 무효화 (로그아웃)
export async function revokeRefreshToken(
  refresh_token: string
): Promise<boolean> {
  const token_hash = hashToken(refresh_token);

  const stored_token = await RefreshToken.findOne({
    where: {
      token_hash,
      revoked_at: null,
    },
  });

  if (!stored_token) return false;

  await stored_token.revoke();
  return true;
}

// 사용자의 모든 refresh_token 무효화 (모든 기기 로그아웃)
export async function revokeAllUserTokens(user_id: string): Promise<number> {
  const [affected_count] = await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        user_id,
        revoked_at: null,
      },
    }
  );

  return affected_count;
}

// 만료된 토큰 정리 (배치 작업용)
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await RefreshToken.destroy({
    where: {
      expires_at: {
        [Op.lt]: new Date(),
      },
    },
  });

  return result;
}
