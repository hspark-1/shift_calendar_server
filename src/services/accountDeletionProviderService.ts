import axios, { AxiosInstance } from "axios";
import { getKakaoAdminKey } from "../config/environment";
import { OAuthAuthorization, User } from "../models";
import { appleService } from "./appleService";

export type AccountDeletionProviderErrorCode =
  | "APPLE_TOKEN_DECRYPT_FAILED"
  | "APPLE_REVOKE_RETRYABLE"
  | "APPLE_REVOKE_REJECTED"
  | "KAKAO_UNLINK_RETRYABLE"
  | "KAKAO_UNLINK_REJECTED"
  | "PROVIDER_USER_NOT_FOUND";

export class AccountDeletionProviderError extends Error {
  constructor(
    public readonly code: AccountDeletionProviderErrorCode,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AccountDeletionProviderError";
  }
}

interface ProviderServiceDependencies {
  http_client?: Pick<AxiosInstance, "post">;
  find_user_by_pk?: (user_id: string) => Promise<User | null>;
  kakao_admin_key_provider?: () => string;
}

function getUpstreamErrorCode(error: unknown): string | number | null {
  if (!axios.isAxiosError(error) || typeof error.response?.data !== "object") {
    return null;
  }
  const data = error.response.data as { error?: unknown; code?: unknown };
  if (typeof data.error === "string") return data.error;
  if (typeof data.code === "number" || typeof data.code === "string") {
    return data.code;
  }
  return null;
}

function isRetryableHttpError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
}

export class AccountDeletionProviderService {
  private readonly http_client: Pick<AxiosInstance, "post">;
  private readonly find_user_by_pk: (user_id: string) => Promise<User | null>;
  private readonly kakao_admin_key_provider: () => string;

  constructor(dependencies: ProviderServiceDependencies = {}) {
    this.http_client = dependencies.http_client ?? axios;
    this.find_user_by_pk =
      dependencies.find_user_by_pk ?? ((user_id) => User.findByPk(user_id));
    this.kakao_admin_key_provider =
      dependencies.kakao_admin_key_provider ?? getKakaoAdminKey;
  }

  async revokeApple(user_id: string): Promise<void> {
    const authorization = await OAuthAuthorization.findOne({
      where: { user_id, provider: "APPLE", revoked_at: null },
    });
    if (!authorization) return;

    let refresh_token: string;
    try {
      refresh_token = appleService.decryptRefreshToken(
        {
          ciphertext: authorization.refresh_token_ciphertext,
          iv: authorization.refresh_token_iv,
          auth_tag: authorization.refresh_token_auth_tag,
        },
        authorization.provider_subject,
        authorization.client_id,
      );
    } catch {
      throw new AccountDeletionProviderError(
        "APPLE_TOKEN_DECRYPT_FAILED",
        false,
      );
    }

    const parameters = new URLSearchParams({
      client_id: authorization.client_id,
      client_secret: appleService.generateClientSecret(authorization.client_id),
      token: refresh_token,
      token_type_hint: "refresh_token",
    });
    try {
      await this.http_client.post(
        "https://appleid.apple.com/auth/revoke",
        parameters.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 5000,
        },
      );
    } catch (error) {
      throw new AccountDeletionProviderError(
        isRetryableHttpError(error)
          ? "APPLE_REVOKE_RETRYABLE"
          : "APPLE_REVOKE_REJECTED",
        isRetryableHttpError(error),
      );
    }
    await authorization.update({
      revoked_at: new Date(),
      updated_at: new Date(),
    });
  }

  async unlinkKakao(user_id: string): Promise<void> {
    const user = await this.find_user_by_pk(user_id);
    if (!user) {
      throw new AccountDeletionProviderError("PROVIDER_USER_NOT_FOUND", false);
    }
    if (!user.kakao_id) return;

    const parameters = new URLSearchParams({
      target_id_type: "user_id",
      target_id: user.kakao_id,
    });
    try {
      const response = await this.http_client.post<{ id: number }>(
        "https://kapi.kakao.com/v1/user/unlink",
        parameters.toString(),
        {
          headers: {
            Authorization: `KakaoAK ${this.kakao_admin_key_provider()}`,
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          },
          timeout: 5000,
        },
      );
      if (String(response.data.id) !== user.kakao_id) {
        throw new AccountDeletionProviderError(
          "KAKAO_UNLINK_REJECTED",
          false,
        );
      }
    } catch (error) {
      if (error instanceof AccountDeletionProviderError) throw error;
      // Kakao -101은 이미 앱과 연결되지 않은 사용자이므로 retry 시 멱등 성공이다.
      if (getUpstreamErrorCode(error) === -101) return;
      const retryable = isRetryableHttpError(error);
      throw new AccountDeletionProviderError(
        retryable ? "KAKAO_UNLINK_RETRYABLE" : "KAKAO_UNLINK_REJECTED",
        retryable,
      );
    }
  }
}

export const accountDeletionProviderService =
  new AccountDeletionProviderService();
