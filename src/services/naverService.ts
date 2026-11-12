import axios from "axios";
import qs from "qs";
import { logError } from "../utils/logger";
import { QueryTypes, UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/database";
import { User } from "../models";
import { normalizePhoneNumber } from "../utils/phone";
import { generateTokens } from "./authService";
import { ensureDefaultTemplate } from "./shiftTemplateService";

export class NaverAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status_code: number,
    message: string,
  ) {
    super(message);
    this.name = "NaverAuthError";
  }
}

interface NaverTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface NaverUserProfile {
  resultcode: string;
  message: string;
  response: {
    id: string;
    email?: string;
    nickname?: string;
    name?: string;
    age?: string;
    gender?: string;
    birthday?: string;
    birthyear?: string;
    mobile?: unknown;
  };
}

export interface NaverUserInfo {
  naver_id: string;
  email: string;
  name: string;
  phone: string | null;
}

/**
 * 네이버 authorization code로 access token을 교환합니다.
 */
export async function exchangeNaverToken(
  code: string,
  state: string | undefined,
  redirect_uri: string
): Promise<string> {
  const naver_client_id = process.env.NAVER_CLIENT_ID;
  const naver_client_secret = process.env.NAVER_CLIENT_SECRET;

  if (!naver_client_id) {
    throw new Error("NAVER_CLIENT_ID 환경변수가 설정되지 않았습니다.");
  }

  if (!naver_client_secret) {
    throw new Error("NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다.");
  }

  const token_url = "https://nid.naver.com/oauth2.0/token";

  const token_params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: naver_client_id,
    client_secret: naver_client_secret,
    code: code,
    redirect_uri: redirect_uri,
  };

  if (state) {
    token_params.state = state;
  }

  const body = qs.stringify(token_params);

  try {
    const response = await axios.post<NaverTokenResponse>(token_url, body, {
      timeout: 5000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
    });

    if (!response.data || typeof response.data.access_token !== "string" || !response.data.access_token.trim()) {
      throw new NaverAuthError("NAVER_INVALID_TOKEN", 400, "네이버 인증 정보를 확인해주세요.");
    }
    return response.data.access_token;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      logError("naver_token_exchange_failed", error);

      if (error.response.status >= 500) {
        throw new NaverAuthError("NAVER_UPSTREAM_UNAVAILABLE", 503, "네이버 로그인에 일시적으로 연결할 수 없습니다.");
      }
      throw new NaverAuthError("NAVER_TOKEN_EXCHANGE_FAILED", 400, "네이버 토큰 교환에 실패했습니다. 다시 로그인해주세요.");
    }
    if (axios.isAxiosError(error)) {
      throw new NaverAuthError("NAVER_UPSTREAM_UNAVAILABLE", 503, "네이버 로그인에 일시적으로 연결할 수 없습니다.");
    }
    throw error;
  }
}

/**
 * 네이버 access token으로 사용자 정보를 조회합니다.
 */
export async function getNaverUserInfo(
  access_token: string
): Promise<NaverUserInfo> {
  const user_info_url = "https://openapi.naver.com/v1/nid/me";

  try {
    const response = await axios.get<NaverUserProfile>(user_info_url, {
      timeout: 5000,
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const { resultcode, response: user_data } = response.data ?? {};

    // 네이버 API 응답 성공 확인
    if (resultcode !== "00" || !user_data || typeof user_data.id !== "string" || !user_data.id.trim()) {
      throw new NaverAuthError("NAVER_INVALID_PROFILE", 400, "네이버 사용자 정보를 확인할 수 없습니다.");
    }

    // 이메일 추출 (필수값)
    const email = user_data.email;
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new NaverAuthError("NAVER_EMAIL_UNAVAILABLE", 400,
        "네이버 계정에 이메일 정보가 없습니다. 이메일 제공에 동의해주세요."
      );
    }

    // 닉네임/이름 추출
    const name = [user_data.nickname, user_data.name].find(
      (value) => typeof value === "string" && value.trim().length > 0,
    ) || "네이버 사용자";
    // 동의하지 않았거나 지원하지 않는 번호는 가입 프로필에서 직접 입력한다.
    const phone = typeof user_data.mobile === "string"
      ? normalizePhoneNumber(user_data.mobile)
      : null;

    return {
      naver_id: user_data.id,
      email,
      name,
      phone,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      logError("naver_user_info_failed", error);

      const invalid_token = error.response.status === 401 || error.response.status === 403;
      throw new NaverAuthError(
        invalid_token ? "NAVER_INVALID_TOKEN" : "NAVER_UPSTREAM_UNAVAILABLE",
        invalid_token ? 401 : 503,
        invalid_token ? "네이버에 다시 로그인해주세요." : "네이버 사용자 정보 조회에 일시적으로 실패했습니다.",
      );
    }
    if (axios.isAxiosError(error)) {
      throw new NaverAuthError("NAVER_UPSTREAM_UNAVAILABLE", 503, "네이버 로그인에 일시적으로 연결할 수 없습니다.");
    }
    throw error;
  }
}

/**
 * 네이버 OAuth 전체 플로우: code → token → 사용자 정보
 */
export async function processNaverLogin(
  code: string,
  state: string | undefined,
  redirect_uri: string
): Promise<NaverUserInfo> {
  const access_token = await exchangeNaverToken(code, state, redirect_uri);
  const user_info = await getNaverUserInfo(access_token);
  return user_info;
}

// 외부 API 조회는 호출자가 완료한 뒤 사용자·기본 템플릿·세션을 원자적으로 저장한다.
export async function completeNaverLogin(
  identity: NaverUserInfo,
  device_info?: string,
): Promise<{
  user: User;
  tokens: Awaited<ReturnType<typeof generateTokens>>;
  is_new_user: boolean;
}> {
  try {
    return await sequelize.transaction(async (transaction) => {
      // 없는 사용자 행도 잠가 동일 회원/이메일의 최초 로그인 경합을 직렬화한다.
      for (const lock_key of [`shiftmate:naver:${identity.naver_id}`, `shiftmate:naver-email:${identity.email}`]) {
        await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:lock_key))", {
          replacements: { lock_key }, type: QueryTypes.SELECT, transaction,
        });
      }
      let user = await User.findOne({
        where: { naver_id: identity.naver_id }, transaction, lock: transaction.LOCK.UPDATE,
      });
      let is_new_user = false;
      if (!user) {
        user = await User.findOne({
          where: { email: identity.email }, transaction, lock: transaction.LOCK.UPDATE,
        });
        if (user?.naver_id && user.naver_id !== identity.naver_id) {
          throw new NaverAuthError("NAVER_ACCOUNT_CONFLICT", 409, "이미 다른 네이버 계정이 연결되어 있습니다.");
        }
      }
      if (user && user.account_status !== "ACTIVE") {
        throw new NaverAuthError("ACCOUNT_DELETION_IN_PROGRESS", 409, "회원 탈퇴가 진행 중입니다.");
      }
      const should_store_phone = identity.phone !== null && (!user || user.phone == null);
      if (should_store_phone) {
        const phone_owner = await User.findOne({ where: { phone: identity.phone! }, transaction });
        if (phone_owner && phone_owner.user_id !== user?.user_id) {
          throw new NaverAuthError("PHONE_ALREADY_EXISTS", 409, "이미 사용 중인 전화번호입니다.");
        }
      }
      if (!user) {
        user = await User.create({
          email: identity.email, name: identity.name, naver_id: identity.naver_id,
          phone: identity.phone, profile_image_url: null, timezone: "Asia/Seoul",
        }, { transaction });
        is_new_user = true;
      } else {
        user.naver_id = identity.naver_id;
        if (should_store_phone) user.phone = identity.phone;
        await user.save({ transaction });
      }
      await ensureDefaultTemplate(user.user_id, transaction);
      const tokens = await generateTokens(user, { device_info, transaction });
      return { user, tokens, is_new_user };
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError && error.errors.some(
      (item) => item.path === "phone" || item.path === "idx_users_phone",
    )) {
      throw new NaverAuthError("PHONE_ALREADY_EXISTS", 409, "이미 사용 중인 전화번호입니다.");
    }
    throw error;
  }
}
