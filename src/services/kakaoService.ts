import axios from "axios";
import qs from "qs";

interface KakaoTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  refresh_token_expires_in: number;
}

interface KakaoUserProfile {
  id: number;
  connected_at: string;
  properties?: {
    nickname?: string;
    profile_image?: string;
    thumbnail_image?: string;
  };
  kakao_account?: {
    profile_nickname_needs_agreement?: boolean;
    profile_image_needs_agreement?: boolean;
    profile?: {
      nickname?: string;
      thumbnail_image_url?: string;
      profile_image_url?: string;
      is_default_image?: boolean;
    };
    email_needs_agreement?: boolean;
    is_email_valid?: boolean;
    is_email_verified?: boolean;
    email?: string;
  };
}

export interface KakaoUserInfo {
  kakao_id: string;
  email: string;
  name: string;
  profile_image_url?: string;
}

/**
 * 카카오 authorization code로 access token을 교환합니다.
 */
export async function exchangeKakaoToken(
  code: string,
  redirect_uri: string
): Promise<string> {
  const kakao_client_id = process.env.KAKAO_CLIENT_ID;
  const kakao_client_secret = process.env.KAKAO_CLIENT_SECRET;

  if (!kakao_client_id) {
    throw new Error("KAKAO_CLIENT_ID 환경변수가 설정되지 않았습니다.");
  }

  const token_url = "https://kauth.kakao.com/oauth/token";

  // client_secret이 설정된 경우 포함
  const token_params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: kakao_client_id,
    redirect_uri: redirect_uri,
    code: code,
  };

  if (kakao_client_secret) {
    token_params.client_secret = kakao_client_secret;
  }

  const body = qs.stringify(token_params);

  try {
    const response = await axios.post<KakaoTokenResponse>(token_url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
    });

    return response.data.access_token;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("카카오 토큰 교환 실패:", {
        status: error.response.status,
        data: error.response.data,
        request_body: {
          grant_type: "authorization_code",
          client_id: kakao_client_id,
          redirect_uri: redirect_uri,
          code: code.substring(0, 20) + "...",
        },
      });

      const kakao_error = error.response.data as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        kakao_error.error_description ||
          kakao_error.error ||
          "카카오 토큰 교환에 실패했습니다."
      );
    }
    throw error;
  }
}

/**
 * 카카오 access token으로 사용자 정보를 조회합니다.
 */
export async function getKakaoUserInfo(
  access_token: string
): Promise<KakaoUserInfo> {
  const user_info_url = "https://kapi.kakao.com/v2/user/me";

  const response = await axios.get<KakaoUserProfile>(user_info_url, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${access_token}`,
    },
  });

  const { id, kakao_account, properties } = response.data;

  // 이메일 추출 (필수값이 아닐 수 있음)
  const email = kakao_account?.email;
  if (!email) {
    throw new Error(
      "카카오 계정에 이메일 정보가 없습니다. 이메일 제공에 동의해주세요."
    );
  }

  // 닉네임 추출 (여러 소스에서)
  const name =
    kakao_account?.profile?.nickname || properties?.nickname || "카카오 사용자";

  // 프로필 이미지 추출
  const profile_image_url =
    kakao_account?.profile?.profile_image_url || properties?.profile_image;

  return {
    kakao_id: String(id),
    email,
    name,
    profile_image_url,
  };
}

/**
 * 카카오 OAuth 전체 플로우: code → token → 사용자 정보
 */
export async function processKakaoLogin(
  code: string,
  redirect_uri: string
): Promise<KakaoUserInfo> {
  const access_token = await exchangeKakaoToken(code, redirect_uri);
  const user_info = await getKakaoUserInfo(access_token);
  return user_info;
}
