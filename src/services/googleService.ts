import {
  LoginTicket,
  OAuth2Client,
  TokenPayload,
  VerifyIdTokenOptions,
} from "google-auth-library";
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
import { generateTokens } from "./authService";
import { ensureDefaultTemplate } from "./shiftTemplateService";

export type GoogleAuthErrorCode =
  | "GOOGLE_INVALID_TOKEN"
  | "GOOGLE_EMAIL_UNAVAILABLE"
  | "ACCOUNT_LINK_REQUIRED"
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
  profile_image_url: string | null;
}

export interface CompleteGoogleLoginInput {
  id_token: string;
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

function normalizeGooglePicture(payload: TokenPayload): string | null {
  if (typeof payload.picture !== "string") return null;
  const normalized_picture = payload.picture.trim();
  if (normalized_picture.length === 0 || normalized_picture.length > 2048) {
    return null;
  }
  try {
    const parsed_picture = new URL(normalized_picture);
    if (parsed_picture.protocol !== "https:") return null;
    return parsed_picture.toString();
  } catch {
    return null;
  }
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

  constructor(dependencies: GoogleServiceDependencies = {}) {
    this.oauth_client = dependencies.oauth_client ?? null;
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
      profile_image_url: normalizeGooglePicture(payload),
    };
  }

  async completeLogin(
    input: CompleteGoogleLoginInput,
  ): Promise<CompleteGoogleLoginResult> {
    const identity = await this.verifyIdentityToken(input.id_token);

    try {
      return await this.completeLoginTransaction(identity, input.device_info);
    } catch (error) {
      if (error instanceof GoogleAuthError) throw error;
      if (error instanceof UniqueConstraintError) {
        const concurrent_user = await User.findOne({
          where: { google_id: identity.subject },
        });
        if (concurrent_user) {
          return this.issueTokensForExistingUser(
            identity.subject,
            input.device_info,
          );
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
    device_info?: string,
  ): Promise<CompleteGoogleLoginResult> {
    return sequelize.transaction(async (transaction) => {
      await this.lockGoogleSubject(identity.subject, transaction);

      let user = await User.findOne({
        where: { google_id: identity.subject },
        transaction,
      });
      let is_new_user = false;

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
            profile_image_url: identity.profile_image_url,
            timezone: "Asia/Seoul",
            google_id: identity.subject,
          },
          { transaction },
        );
        await ensureDefaultTemplate(user.user_id, transaction);
        is_new_user = true;
      }

      const tokens = await generateTokens(user, {
        device_info,
        transaction,
      });
      return { user, tokens, is_new_user };
    });
  }

  private async issueTokensForExistingUser(
    subject: string,
    device_info?: string,
  ): Promise<CompleteGoogleLoginResult> {
    return sequelize.transaction(async (transaction) => {
      await this.lockGoogleSubject(subject, transaction);
      const user = await User.findOne({
        where: { google_id: subject },
        transaction,
      });
      if (!user) throw new Error("GOOGLE_CONCURRENT_USER_NOT_FOUND");
      const tokens = await generateTokens(user, { device_info, transaction });
      return { user, tokens, is_new_user: false };
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
