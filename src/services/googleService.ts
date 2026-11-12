import {
  LoginTicket,
  OAuth2Client,
  TokenPayload,
  VerifyIdTokenOptions,
} from "google-auth-library";
import axios, { AxiosInstance } from "axios";
import {
  col,
  fn,
  QueryTypes,
  Transaction,
  UniqueConstraintError,
  where,
} from "sequelize";
import { sequelize } from "../config/database";
import { getRequiredEnvironmentVariable } from "../config/environment";
import { User } from "../models";
import { normalizePhoneNumber } from "../utils/phone";
import { generateTokens } from "./authService";
import { ensureDefaultTemplate } from "./shiftTemplateService";

export type GoogleAuthErrorCode =
  | "GOOGLE_INVALID_TOKEN"
  | "GOOGLE_EMAIL_UNAVAILABLE"
  | "ACCOUNT_LINK_REQUIRED"
  | "PHONE_ALREADY_EXISTS"
  | "ACCOUNT_DELETION_IN_PROGRESS"
  | "GOOGLE_UPSTREAM_UNAVAILABLE";

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: GoogleAuthErrorCode,
    public readonly status_code: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name: string;
}

export interface CompleteGoogleLoginInput {
  id_token: string;
  access_token?: string;
  device_info?: string;
}

export interface CompleteGoogleLoginResult {
  user: User;
  tokens: Awaited<ReturnType<typeof generateTokens>>;
  is_new_user: boolean;
}

interface GoogleTokenVerifier {
  verifyIdToken(options: VerifyIdTokenOptions): Promise<LoginTicket>;
}

interface GoogleServiceDependencies {
  oauth_client?: GoogleTokenVerifier;
  http_client?: Pick<AxiosInstance, "get">;
}

interface GooglePhoneEntry {
  value?: unknown;
  canonicalForm?: unknown;
  metadata?: { primary?: unknown };
}

// Google 번호만 국내 휴대전화 저장 형식으로 변환한다. 전역 전화번호 정책은 유지한다.
function normalizeGooglePhone(value: unknown): string | null {
  if (typeof value !== "string" || !/^[+0-9 ()-]+$/.test(value.trim())) {
    return null;
  }
  let digits = value.trim().replace(/[ ()-]/g, "");
  if (digits.startsWith("+82")) digits = `0${digits.slice(3)}`;
  if (!/^01[016789][0-9]{7,8}$/.test(digits)) return null;
  return normalizePhoneNumber(digits);
}

function selectGooglePhone(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const entries = (data as { phoneNumbers?: unknown }).phoneNumbers;
  if (!Array.isArray(entries)) return null;
  const numbers = new Set<string>();
  const primary_numbers = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const phone_entry = entry as GooglePhoneEntry;
    const phone = normalizeGooglePhone(
      phone_entry.canonicalForm ?? phone_entry.value,
    );
    if (!phone) continue;
    numbers.add(phone);
    if (phone_entry.metadata?.primary === true) primary_numbers.add(phone);
  }
  if (numbers.size === 1) return [...numbers][0];
  return primary_numbers.size === 1 ? [...primary_numbers][0] : null;
}

function isPhoneUniqueConstraint(error: UniqueConstraintError): boolean {
  return (
    error.errors.some(
      (item) => item.path === "phone" || item.path === "idx_users_phone",
    ) || Object.keys(error.fields ?? {}).includes("phone")
  );
}

function phoneAlreadyExists(): GoogleAuthError {
  return new GoogleAuthError(
    "PHONE_ALREADY_EXISTS", 409, "이미 사용 중인 전화번호입니다.",
  );
}

interface ErrorLike {
  code?: unknown;
  response?: unknown;
  config?: unknown;
}

const google_email_pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const google_network_error_codes = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function normalizeGoogleEmail(payload: TokenPayload): string | null {
  if (payload.email_verified !== true || typeof payload.email !== "string") {
    return null;
  }
  const normalized_email = payload.email.trim().toLowerCase();
  return google_email_pattern.test(normalized_email)
    ? normalized_email
    : null;
}

function buildGoogleDisplayName(payload: TokenPayload, email: string): string {
  if (typeof payload.name === "string") {
    const normalized_name = payload.name.trim();
    if (normalized_name.length >= 1 && normalized_name.length <= 100) {
      return normalized_name;
    }
  }
  return email.slice(0, email.indexOf("@")).slice(0, 100);
}

function isGoogleUpstreamError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const error_like = error as Error & ErrorLike;
  return (
    error.message.startsWith("Failed to retrieve verification certificates:") ||
    error_like.response !== undefined ||
    error_like.config !== undefined ||
    (typeof error_like.code === "string" &&
      google_network_error_codes.has(error_like.code))
  );
}

export class GoogleService {
  private oauth_client: GoogleTokenVerifier | null;
  private http_client: Pick<AxiosInstance, "get">;

  constructor(dependencies: GoogleServiceDependencies = {}) {
    this.oauth_client = dependencies.oauth_client ?? null;
    this.http_client = dependencies.http_client ?? axios;
  }

  initialize(): void {
    getRequiredEnvironmentVariable("GOOGLE_SERVER_CLIENT_ID");
    if (!this.oauth_client) this.oauth_client = new OAuth2Client();
  }

  async verifyIdentityToken(id_token: string): Promise<VerifiedGoogleIdentity> {
    if (!this.oauth_client) this.oauth_client = new OAuth2Client();

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.oauth_client.verifyIdToken({
        idToken: id_token,
        audience: getRequiredEnvironmentVariable("GOOGLE_SERVER_CLIENT_ID"),
      });
      payload = ticket.getPayload();
    } catch (error) {
      if (isGoogleUpstreamError(error)) {
        throw new GoogleAuthError(
          "GOOGLE_UPSTREAM_UNAVAILABLE",
          503,
          "Google 인증 서버에 일시적으로 연결할 수 없습니다.",
        );
      }
      throw new GoogleAuthError(
        "GOOGLE_INVALID_TOKEN",
        401,
        "Google 인증 정보를 확인할 수 없습니다.",
      );
    }

    if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new GoogleAuthError(
        "GOOGLE_INVALID_TOKEN",
        401,
        "Google 인증 정보를 확인할 수 없습니다.",
      );
    }
    const email = normalizeGoogleEmail(payload);
    if (!email) {
      throw new GoogleAuthError(
        "GOOGLE_EMAIL_UNAVAILABLE",
        400,
        "Google 계정의 확인된 이메일을 받을 수 없습니다.",
      );
    }

    return {
      subject: payload.sub,
      email,
      name: buildGoogleDisplayName(payload, email),
    };
  }

  async getPhoneForIdentity(
    access_token: string | undefined,
    subject: string,
  ): Promise<string | null> {
    if (!access_token) return null;
    // 동일 access token으로 계정을 대조한 뒤 전화번호만 요청한다. 토큰/응답은 로그에 남기지 않는다.
    const options = {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 5000,
      maxRedirects: 0,
      maxContentLength: 65536,
    };
    try {
      const user_info = await this.http_client.get<{ sub?: unknown }>(
        "https://openidconnect.googleapis.com/v1/userinfo",
        options,
      );
      if (!user_info.data || typeof user_info.data.sub !== "string") return null;
      if (user_info.data.sub !== subject) {
        throw new GoogleAuthError(
          "GOOGLE_INVALID_TOKEN", 401,
          "Google 인증 계정이 일치하지 않습니다. 다시 로그인해주세요.",
        );
      }
      const response = await this.http_client.get<unknown>(
        "https://people.googleapis.com/v1/people/me",
        {
          ...options,
          params: {
            personFields: "phoneNumbers",
            sources: "READ_SOURCE_TYPE_PROFILE",
          },
        },
      );
      return selectGooglePhone(response.data);
    } catch (error) {
      // 선택 정보 조회의 권한 거부/만료/네트워크 장애는 직접 입력으로 복귀한다.
      if (axios.isAxiosError(error)) return null;
      throw error;
    }
  }

  async completeLogin(
    input: CompleteGoogleLoginInput,
  ): Promise<CompleteGoogleLoginResult> {
    const identity = await this.verifyIdentityToken(input.id_token);
    const phone = await this.getPhoneForIdentity(
      input.access_token, identity.subject,
    );

    try {
      return await this.completeLoginTransaction(identity, phone, input.device_info);
    } catch (error) {
      if (error instanceof GoogleAuthError) throw error;
      if (error instanceof UniqueConstraintError) {
        if (isPhoneUniqueConstraint(error)) throw phoneAlreadyExists();
        const concurrent_user = await User.findOne({
          where: { google_id: identity.subject },
        });
        if (concurrent_user) {
          try {
            return await this.completeLoginTransaction(identity, phone, input.device_info);
          } catch (retry_error) {
            if (retry_error instanceof UniqueConstraintError && isPhoneUniqueConstraint(retry_error)) {
              throw phoneAlreadyExists();
            }
            throw retry_error;
          }
        }

        const conflicting_email_user = await User.findOne({
          where: where(fn("lower", col("email")), identity.email),
        });
        if (conflicting_email_user) {
          throw new GoogleAuthError(
            "ACCOUNT_LINK_REQUIRED",
            409,
            "이미 다른 로그인 방식으로 가입된 이메일입니다. 기존 로그인 방식으로 로그인해주세요.",
          );
        }
      }
      throw error;
    }
  }

  private async completeLoginTransaction(
    identity: VerifiedGoogleIdentity,
    phone: string | null,
    device_info?: string,
  ): Promise<CompleteGoogleLoginResult> {
    return sequelize.transaction(async (transaction) => {
      await this.lockGoogleSubject(identity.subject, transaction);

      let user = await User.findOne({
        where: { google_id: identity.subject },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      let is_new_user = false;

      if (user && user.account_status !== "ACTIVE") {
        throw new GoogleAuthError(
          "ACCOUNT_DELETION_IN_PROGRESS", 409, "회원 탈퇴가 진행 중인 계정입니다.",
        );
      }

      if (phone && (!user || user.phone == null)) {
        const phone_owner = await User.findOne({
          where: { phone }, attributes: ["user_id"], transaction,
        });
        if (phone_owner && phone_owner.user_id !== user?.user_id) {
          throw phoneAlreadyExists();
        }
      }

      if (!user) {
        const existing_email_user = await User.findOne({
          where: where(fn("lower", col("email")), identity.email),
          transaction,
        });
        if (existing_email_user) {
          throw new GoogleAuthError(
            "ACCOUNT_LINK_REQUIRED",
            409,
            "이미 다른 로그인 방식으로 가입된 이메일입니다. 기존 로그인 방식으로 로그인해주세요.",
          );
        }

        user = await User.create(
          {
            email: identity.email,
            name: identity.name,
            profile_image_url: null,
            phone,
            timezone: "Asia/Seoul",
            google_id: identity.subject,
          },
          { transaction },
        );
        await ensureDefaultTemplate(user.user_id, transaction);
        is_new_user = true;
      } else if (user.phone == null && phone) {
        user.phone = phone;
        await user.save({ transaction, fields: ["phone"] });
      }

      const tokens = await generateTokens(user, {
        device_info,
        transaction,
      });
      return { user, tokens, is_new_user };
    });
  }

  private async lockGoogleSubject(
    subject: string,
    transaction: Transaction,
  ): Promise<void> {
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext(:lock_key))",
      {
        replacements: { lock_key: `shiftmate:google:${subject}` },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
  }
}

export const googleService = new GoogleService();
