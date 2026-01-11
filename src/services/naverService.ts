import axios from "axios";
import qs from "qs";

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
    profile_image?: string;
    age?: string;
    gender?: string;
    birthday?: string;
    birthyear?: string;
    mobile?: string;
  };
}

export interface NaverUserInfo {
  naver_id: string;
  email: string;
  name: string;
  profile_image_url?: string;
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
    });

    return response.data.access_token;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("네이버 토큰 교환 실패:", {
        status: error.response.status,
        data: error.response.data,
        request_body: {
          grant_type: "authorization_code",
          client_id: naver_client_id,
          redirect_uri: redirect_uri,
          code: code.substring(0, 20) + "...",
        },
      });

      const naver_error = error.response.data as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        naver_error.error_description ||
          naver_error.error ||
          "네이버 토큰 교환에 실패했습니다."
      );
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
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const { resultcode, message, response: user_data } = response.data;

    // 네이버 API 응답 성공 확인
    if (resultcode !== "00") {
      throw new Error(`네이버 사용자 정보 조회 실패: ${message}`);
    }

    // 이메일 추출 (필수값)
    const email = user_data.email;
    if (!email) {
      throw new Error(
        "네이버 계정에 이메일 정보가 없습니다. 이메일 제공에 동의해주세요."
      );
    }

    // 닉네임/이름 추출
    const name = user_data.nickname || user_data.name || "네이버 사용자";

    // 프로필 이미지 추출
    const profile_image_url = user_data.profile_image;

    return {
      naver_id: user_data.id,
      email,
      name,
      profile_image_url,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error("네이버 사용자 정보 조회 실패:", {
        status: error.response.status,
        data: error.response.data,
      });

      throw new Error(
        error.response.data?.message ||
          "네이버 사용자 정보 조회에 실패했습니다."
      );
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

