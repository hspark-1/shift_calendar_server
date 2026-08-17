import axios, { AxiosInstance } from "axios";
import qs from "qs";
import { QueryTypes, Transaction, UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/database";
import { getRequiredEnvironmentVariable } from "../config/environment";
import { User } from "../models";
import { generateTokens } from "./authService";
import { ensureDefaultTemplate } from "./shiftTemplateService";

interface KakaoTokenResponse {
  access_token: string;
}

interface KakaoAccessTokenInfoResponse {
  id?: unknown;
  expires_in?: unknown;
  app_id?: unknown;
}

interface KakaoUserProfile {
  id?: unknown;
  properties?: {
    nickname?: string;
    profile_image?: string;
  };
  kakao_account?: {
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
    email?: string;
  };
}

export type KakaoAuthErrorCode =
  | "KAKAO_INVALID_TOKEN"
  | "KAKAO_TOKEN_APP_MISMATCH"
  | "KAKAO_TOKEN_SUBJECT_MISMATCH"
  | "KAKAO_EMAIL_UNAVAILABLE"
  | "KAKAO_ACCOUNT_CONFLICT"
  | "KAKAO_INVALID_UPSTREAM_RESPONSE"
  | "KAKAO_UPSTREAM_UNAVAILABLE";

export class KakaoAuthError extends Error {
  constructor(
    public readonly code: KakaoAuthErrorCode,
    public readonly status_code: number,
    message: string,
  ) {
    super(message);
    this.name = "KakaoAuthError";
  }
}

export interface KakaoUserInfo {
  kakao_id: string;
  email: string;
  name: string;
  profile_image_url?: string;
}

export interface CompleteKakaoLoginInput {
  access_token: string;
  device_info?: string;
}

export interface CompleteKakaoLoginResult {
  user: User;
  tokens: Awaited<ReturnType<typeof generateTokens>>;
  is_new_user: boolean;
}

interface KakaoServiceDependencies {
  http_client?: Pick<AxiosInstance, "get">;
}

const kakao_request_timeout_ms = 5000;
const transient_kakao_error_codes = new Set([-1, -7, -603, -9798]);

function getKakaoErrorCode(error: unknown): number | null {
  if (!axios.isAxiosError(error) || typeof error.response?.data !== "object") {
    return null;
  }
  const code = (error.response.data as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function mapKakaoHttpError(error: unknown): KakaoAuthError {
  if (axios.isAxiosError(error)) {
    const status_code = error.response?.status;
    const kakao_error_code = getKakaoErrorCode(error);
    if (
      status_code === undefined ||
      status_code === 429 ||
      (status_code !== undefined && status_code >= 500) ||
      (kakao_error_code !== null &&
        transient_kakao_error_codes.has(kakao_error_code))
    ) {
      return new KakaoAuthError(
        "KAKAO_UPSTREAM_UNAVAILABLE",
        503,
        "카카오 인증 서버에 일시적으로 연결할 수 없습니다.",
      );
    }
    if (status_code === 400 || status_code === 401 || status_code === 403) {
      return new KakaoAuthError(
        "KAKAO_INVALID_TOKEN",
        401,
        "카카오 인증 정보를 확인할 수 없습니다.",
      );
    }
  }
  return new KakaoAuthError(
    "KAKAO_UPSTREAM_UNAVAILABLE",
    503,
    "카카오 인증 서버에 일시적으로 연결할 수 없습니다.",
  );
}

function normalizePositiveInteger(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  return value;
}

function invalidUpstreamResponse(): KakaoAuthError {
  return new KakaoAuthError(
    "KAKAO_INVALID_UPSTREAM_RESPONSE",
    502,
    "카카오 인증 서버 응답을 확인할 수 없습니다.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildDisplayName(profile: KakaoUserProfile): string {
  const candidates = [
    profile.kakao_account?.profile?.nickname,
    profile.properties?.nickname,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized_name = candidate.trim();
    if (normalized_name.length >= 1 && normalized_name.length <= 100) {
      return normalized_name;
    }
  }
  return "카카오 사용자";
}

export class KakaoService {
  private readonly http_client: Pick<AxiosInstance, "get">;

  constructor(dependencies: KakaoServiceDependencies = {}) {
    this.http_client = dependencies.http_client ?? axios;
  }

  async verifyAccessToken(access_token: string): Promise<KakaoUserInfo> {
    let token_info: KakaoAccessTokenInfoResponse;
    try {
      const response = await this.http_client.get<KakaoAccessTokenInfoResponse>(
        "https://kapi.kakao.com/v1/user/access_token_info",
        {
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: kakao_request_timeout_ms,
        },
      );
      if (!isRecord(response.data)) throw invalidUpstreamResponse();
      token_info = response.data;
    } catch (error) {
      if (error instanceof KakaoAuthError) throw error;
      throw mapKakaoHttpError(error);
    }

    const token_user_id = normalizePositiveInteger(token_info.id);
    const token_app_id = normalizePositiveInteger(token_info.app_id);
    if (
      !token_user_id ||
      !token_app_id ||
      !Number.isSafeInteger(token_info.expires_in) ||
      Number(token_info.expires_in) <= 0
    ) {
      throw invalidUpstreamResponse();
    }
    if (token_app_id !== getRequiredEnvironmentVariable("KAKAO_APP_ID")) {
      throw new KakaoAuthError(
        "KAKAO_TOKEN_APP_MISMATCH",
        401,
        "유효하지 않은 카카오 로그인 정보입니다.",
      );
    }

    let profile: KakaoUserProfile;
    try {
      const response = await this.http_client.get<KakaoUserProfile>(
        "https://kapi.kakao.com/v2/user/me",
        {
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: kakao_request_timeout_ms,
        },
      );
      if (!isRecord(response.data)) throw invalidUpstreamResponse();
      profile = response.data;
    } catch (error) {
      if (error instanceof KakaoAuthError) throw error;
      throw mapKakaoHttpError(error);
    }

    const profile_user_id = normalizePositiveInteger(profile.id);
    if (!profile_user_id) throw invalidUpstreamResponse();
    if (profile_user_id !== token_user_id) {
      throw new KakaoAuthError(
        "KAKAO_TOKEN_SUBJECT_MISMATCH",
        401,
        "유효하지 않은 카카오 로그인 정보입니다.",
      );
    }

    const raw_email = profile.kakao_account?.email;
    const email = typeof raw_email === "string" ? raw_email.trim() : "";
    if (!email) {
      throw new KakaoAuthError(
        "KAKAO_EMAIL_UNAVAILABLE",
        400,
        "카카오 계정의 이메일을 받을 수 없습니다.",
      );
    }

    return {
      kakao_id: profile_user_id,
      email,
      name: buildDisplayName(profile),
      profile_image_url:
        profile.kakao_account?.profile?.profile_image_url ||
        profile.properties?.profile_image,
    };
  }

  async completeLogin(
    input: CompleteKakaoLoginInput,
  ): Promise<CompleteKakaoLoginResult> {
    const identity = await this.verifyAccessToken(input.access_token);
    try {
      return await sequelize.transaction((transaction) =>
        this.completeLoginTransaction(identity, input.device_info, transaction),
      );
    } catch (error) {
      if (error instanceof KakaoAuthError) throw error;
      if (error instanceof UniqueConstraintError) {
        const existing_user = await User.findOne({
          where: { email: identity.email },
        });
        if (existing_user?.kakao_id !== identity.kakao_id) {
          throw this.accountConflict();
        }
      }
      throw error;
    }
  }

  private async completeLoginTransaction(
    identity: KakaoUserInfo,
    device_info: string | undefined,
    transaction: Transaction,
  ): Promise<CompleteKakaoLoginResult> {
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext(:lock_key))",
      {
        replacements: { lock_key: `shiftmate:kakao:${identity.kakao_id}` },
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    let user = await User.findOne({
      where: { kakao_id: identity.kakao_id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    let is_new_user = false;

    if (!user) {
      const existing_email_user = await User.findOne({
        where: { email: identity.email },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing_email_user) {
        if (
          existing_email_user.kakao_id &&
          existing_email_user.kakao_id !== identity.kakao_id
        ) {
          throw this.accountConflict();
        }
        existing_email_user.kakao_id = identity.kakao_id;
        await existing_email_user.save({ transaction });
        user = existing_email_user;
      } else {
        user = await User.create(
          {
            email: identity.email,
            name: identity.name,
            profile_image_url: identity.profile_image_url,
            kakao_id: identity.kakao_id,
            timezone: "Asia/Seoul",
          },
          { transaction },
        );
        is_new_user = true;
      }
    }

    await ensureDefaultTemplate(user.user_id, transaction);
    const tokens = await generateTokens(user, { device_info, transaction });
    return { user, tokens, is_new_user };
  }

  private accountConflict(): KakaoAuthError {
    return new KakaoAuthError(
      "KAKAO_ACCOUNT_CONFLICT",
      409,
      "이미 다른 카카오 계정이 연결된 이메일입니다.",
    );
  }
}

export const kakaoService = new KakaoService();

/**
 * 1차 배포 동안 유지하는 레거시 Web authorization-code 교환입니다.
 */
export async function exchangeKakaoToken(
  code: string,
  redirect_uri: string,
): Promise<string> {
  const kakao_client_id = getRequiredEnvironmentVariable("KAKAO_CLIENT_ID");
  const token_params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: kakao_client_id,
    redirect_uri,
    code,
  };
  if (process.env.KAKAO_CLIENT_SECRET) {
    token_params.client_secret = process.env.KAKAO_CLIENT_SECRET;
  }
  try {
    const response = await axios.post<KakaoTokenResponse>(
      "https://kauth.kakao.com/oauth/token",
      qs.stringify(token_params),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        timeout: kakao_request_timeout_ms,
      },
    );
    return response.data.access_token;
  } catch (error) {
    throw mapKakaoHttpError(error);
  }
}

export async function processKakaoLogin(
  code: string,
  redirect_uri: string,
): Promise<KakaoUserInfo> {
  const access_token = await exchangeKakaoToken(code, redirect_uri);
  return kakaoService.verifyAccessToken(access_token);
}
