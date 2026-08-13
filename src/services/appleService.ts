import axios, { AxiosInstance } from "axios";
import crypto, { KeyObject } from "crypto";
import fs from "fs";
import jwt, { JwtPayload } from "jsonwebtoken";
import {
  col,
  fn,
  Op,
  QueryTypes,
  Transaction,
  UniqueConstraintError,
  where,
} from "sequelize";
import { sequelize } from "../config/database";
import {
  getAppleTokenEncryptionKey,
  getBooleanEnvironmentVariable,
  getPositiveIntegerEnvironmentVariable,
  getRequiredEnvironmentVariable,
} from "../config/environment";
import {
  OAuthAuthorization,
  OAuthLoginChallenge,
  OAuthLoginPlatform,
  User,
} from "../models";
import { generateTokens } from "./authService";
import { ensureDefaultTemplate } from "./shiftTemplateService";
import { logError } from "../utils/logger";

const apple_issuer = "https://appleid.apple.com";
const apple_token_url = `${apple_issuer}/auth/token`;
const apple_jwks_url = `${apple_issuer}/auth/keys`;
const apple_android_intent_package = "com.hspark.shiftmate";
const apple_http_timeout_ms = 5000;
const apple_clock_tolerance_seconds = 60;

export type AppleAuthErrorCode =
  | "APPLE_INVALID_PLATFORM"
  | "APPLE_INVALID_CHALLENGE"
  | "APPLE_INVALID_TOKEN"
  | "APPLE_CODE_INVALID"
  | "APPLE_EMAIL_UNAVAILABLE"
  | "APPLE_REFRESH_TOKEN_UNAVAILABLE"
  | "ACCOUNT_LINK_REQUIRED"
  | "APPLE_UPSTREAM_UNAVAILABLE"
  | "APPLE_AUTH_DISABLED";

export class AppleAuthError extends Error {
  constructor(
    public readonly code: AppleAuthErrorCode,
    public readonly status_code: number,
    message: string,
  ) {
    super(message);
    this.name = "AppleAuthError";
  }
}

interface AppleClientConfiguration {
  client_id: string;
  redirect_uri: string | null;
}

interface AppleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token: string;
}

interface AppleJwk extends crypto.JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
  kty?: string;
}

interface AppleJwksResponse {
  keys: AppleJwk[];
}

export interface VerifiedAppleIdentity {
  subject: string;
  email: string | null;
  email_verified: boolean;
  nonce: string;
}

export interface AppleChallengeResponse {
  nonce: string;
  state: string;
  client_id: string;
  redirect_uri: string | null;
  expires_at: string;
}

export interface CompleteAppleLoginInput {
  platform: OAuthLoginPlatform;
  authorization_code: string;
  identity_token?: string;
  state: string;
  nonce: string;
  given_name?: string;
  family_name?: string;
  device_info?: string;
}

export interface CompleteAppleLoginResult {
  user: User;
  tokens: Awaited<ReturnType<typeof generateTokens>>;
  is_new_user: boolean;
}

interface ConsumedChallenge {
  challenge_id: string;
  client_id: string;
  redirect_uri: string | null;
}

interface EncryptedAppleToken {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

interface AppleServiceDependencies {
  http_client?: Pick<AxiosInstance, "get" | "post">;
  now?: () => Date;
  random_bytes?: (size: number) => Buffer;
}

function hashCredential(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isVerifiedEmailClaim(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeOptionalName(value: string | undefined): string | null {
  const normalized_value = value?.trim();
  if (!normalized_value || normalized_value.length > 100) return null;
  return normalized_value;
}

function buildDisplayName(
  family_name: string | undefined,
  given_name: string | undefined,
): string {
  const normalized_family_name = normalizeOptionalName(family_name);
  const normalized_given_name = normalizeOptionalName(given_name);
  return [normalized_family_name, normalized_given_name]
    .filter((value): value is string => value !== null)
    .join(" ") || "Apple 사용자";
}

function parseCacheMaxAgeSeconds(cache_control: unknown): number | null {
  if (typeof cache_control !== "string") return null;
  const match = cache_control.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i);
  if (!match) return null;
  const parsed_value = Number(match[1]);
  return Number.isSafeInteger(parsed_value) && parsed_value >= 0
    ? parsed_value
    : null;
}

export class AppleService {
  private readonly http_client: Pick<AxiosInstance, "get" | "post">;
  private readonly now: () => Date;
  private readonly random_bytes: (size: number) => Buffer;
  private private_key: string | null = null;
  private jwks_cache = new Map<string, KeyObject>();
  private jwks_expires_at_ms = 0;
  private jwks_refresh_promise: Promise<void> | null = null;

  constructor(dependencies: AppleServiceDependencies = {}) {
    this.http_client = dependencies.http_client ?? axios;
    this.now = dependencies.now ?? (() => new Date());
    this.random_bytes = dependencies.random_bytes ?? crypto.randomBytes;
  }

  initialize(): void {
    if (!getBooleanEnvironmentVariable("APPLE_AUTH_ENABLED", false)) return;
    this.getPrivateKey();
    getAppleTokenEncryptionKey();
  }

  private assertEnabled(): void {
    if (!getBooleanEnvironmentVariable("APPLE_AUTH_ENABLED", false)) {
      throw new AppleAuthError(
        "APPLE_AUTH_DISABLED",
        503,
        "Apple 로그인이 현재 비활성화되어 있습니다.",
      );
    }
  }

  resolveAppleClient(platform: OAuthLoginPlatform): AppleClientConfiguration {
    if (platform === "ios") {
      return {
        client_id: getRequiredEnvironmentVariable("APPLE_IOS_CLIENT_ID"),
        redirect_uri: null,
      };
    }
    if (platform !== "android") {
      throw new AppleAuthError(
        "APPLE_INVALID_PLATFORM",
        400,
        "platform은 ios 또는 android여야 합니다.",
      );
    }
    return {
      client_id: getRequiredEnvironmentVariable("APPLE_SERVICE_ID"),
      redirect_uri: getRequiredEnvironmentVariable("APPLE_REDIRECT_URI"),
    };
  }

  async createChallenge(
    platform: OAuthLoginPlatform,
  ): Promise<AppleChallengeResponse> {
    this.assertEnabled();
    const client = this.resolveAppleClient(platform);
    const nonce = this.random_bytes(32).toString("base64url");
    const state = this.random_bytes(32).toString("base64url");
    const ttl_seconds = getPositiveIntegerEnvironmentVariable(
      "APPLE_CHALLENGE_TTL_SECONDS",
      300,
    );
    const expires_at = new Date(this.now().getTime() + ttl_seconds * 1000);

    await OAuthLoginChallenge.create({
      platform,
      state_hash: hashCredential(state),
      nonce_hash: hashCredential(nonce),
      client_id: client.client_id,
      redirect_uri: client.redirect_uri,
      expires_at,
    });

    try {
      await this.cleanupOldChallenges();
    } catch (error) {
      logError("apple_challenge_cleanup_failed", error);
    }

    return {
      nonce,
      state,
      client_id: client.client_id,
      redirect_uri: client.redirect_uri,
      expires_at: expires_at.toISOString(),
    };
  }

  async buildAndroidCallbackRedirect(
    callback: Record<string, unknown>,
  ): Promise<string> {
    this.assertEnabled();
    const state = typeof callback.state === "string" ? callback.state : "";
    const challenge = await OAuthLoginChallenge.findOne({
      where: {
        provider: "APPLE",
        platform: "android",
        state_hash: hashCredential(state),
        consumed_at: null,
        expires_at: { [Op.gt]: this.now() },
      },
    });
    if (!challenge) {
      throw new AppleAuthError(
        "APPLE_INVALID_CHALLENGE",
        400,
        "Apple 로그인 요청이 만료되었습니다. 다시 시도해주세요.",
      );
    }

    const allowed_parameters = ["code", "id_token", "state", "user", "error"];
    const query = new URLSearchParams();
    for (const parameter_name of allowed_parameters) {
      const value = callback[parameter_name];
      if (typeof value === "string" && value.length > 0) {
        query.append(parameter_name, value);
      }
    }

    return `intent://callback?${query.toString()}#Intent;package=${apple_android_intent_package};scheme=signinwithapple;end`;
  }

  async completeLogin(
    input: CompleteAppleLoginInput,
  ): Promise<CompleteAppleLoginResult> {
    this.assertEnabled();
    const challenge = await this.consumeChallenge(
      input.platform,
      input.state,
      input.nonce,
    );
    const token_response = await this.exchangeAuthorizationCode(
      challenge,
      input.authorization_code,
    );
    const exchanged_identity = await this.verifyIdentityToken(
      token_response.id_token,
      challenge.client_id,
      input.nonce,
    );

    if (input.identity_token) {
      const client_identity = await this.verifyIdentityToken(
        input.identity_token,
        challenge.client_id,
        input.nonce,
      );
      if (client_identity.subject !== exchanged_identity.subject) {
        throw new AppleAuthError(
          "APPLE_INVALID_TOKEN",
          400,
          "Apple 인증 정보를 확인할 수 없습니다.",
        );
      }
    }

    const verified_email =
      exchanged_identity.email_verified && exchanged_identity.email
        ? exchanged_identity.email.trim().toLowerCase()
        : null;
    const usable_verified_email =
      verified_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verified_email)
        ? verified_email
        : null;
    const encrypted_refresh_token = token_response.refresh_token
      ? this.encryptRefreshToken(
          token_response.refresh_token,
          exchanged_identity.subject,
          challenge.client_id,
        )
      : null;

    try {
      return await sequelize.transaction(async (transaction) => {
        await this.lockAppleSubject(exchanged_identity.subject, transaction);

        let user = await User.findOne({
          where: { apple_id: exchanged_identity.subject },
          transaction,
        });
        let is_new_user = false;

        if (!user) {
          if (!usable_verified_email) {
            throw new AppleAuthError(
              "APPLE_EMAIL_UNAVAILABLE",
              400,
              "Apple 계정의 확인된 이메일을 받을 수 없습니다.",
            );
          }
          const existing_email_user = await User.findOne({
            where: where(fn("lower", col("email")), usable_verified_email),
            transaction,
          });
          if (existing_email_user) {
            throw new AppleAuthError(
              "ACCOUNT_LINK_REQUIRED",
              409,
              "같은 이메일의 기존 계정이 있습니다. 계정 연결이 필요합니다.",
            );
          }
          user = await User.create(
            {
              email: usable_verified_email,
              name: buildDisplayName(input.family_name, input.given_name),
              apple_id: exchanged_identity.subject,
              timezone: "Asia/Seoul",
            },
            { transaction },
          );
          is_new_user = true;
        }

        await ensureDefaultTemplate(user.user_id, transaction);
        await this.persistAuthorization(
          user,
          exchanged_identity.subject,
          challenge.client_id,
          encrypted_refresh_token,
          transaction,
        );
        const tokens = await generateTokens(user, {
          device_info: input.device_info,
          transaction,
        });
        return { user, tokens, is_new_user };
      });
    } catch (error) {
      if (error instanceof AppleAuthError) throw error;
      if (error instanceof UniqueConstraintError) {
        const conflicting_email_user = usable_verified_email
          ? await User.findOne({
              where: where(fn("lower", col("email")), usable_verified_email),
            })
          : null;
        if (
          conflicting_email_user &&
          conflicting_email_user.apple_id !== exchanged_identity.subject
        ) {
          throw new AppleAuthError(
            "ACCOUNT_LINK_REQUIRED",
            409,
            "같은 이메일의 기존 계정이 있습니다. 계정 연결이 필요합니다.",
          );
        }
      }
      throw error;
    }
  }

  generateClientSecret(client_id: string): string {
    return jwt.sign({}, this.getPrivateKey(), {
      algorithm: "ES256",
      keyid: getRequiredEnvironmentVariable("APPLE_KEY_ID"),
      issuer: getRequiredEnvironmentVariable("APPLE_TEAM_ID"),
      subject: client_id,
      audience: apple_issuer,
      expiresIn: 300,
    });
  }

  encryptRefreshToken(
    refresh_token: string,
    provider_subject: string,
    client_id: string,
  ): EncryptedAppleToken {
    const iv = this.random_bytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      getAppleTokenEncryptionKey(),
      iv,
    );
    cipher.setAAD(Buffer.from(`APPLE\0${provider_subject}\0${client_id}`));
    const ciphertext = Buffer.concat([
      cipher.update(refresh_token, "utf8"),
      cipher.final(),
    ]);
    return { ciphertext, iv, auth_tag: cipher.getAuthTag() };
  }

  decryptRefreshToken(
    encrypted_token: EncryptedAppleToken,
    provider_subject: string,
    client_id: string,
  ): string {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        getAppleTokenEncryptionKey(),
        encrypted_token.iv,
      );
      decipher.setAAD(Buffer.from(`APPLE\0${provider_subject}\0${client_id}`));
      decipher.setAuthTag(encrypted_token.auth_tag);
      return Buffer.concat([
        decipher.update(encrypted_token.ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("APPLE_TOKEN_DECRYPT_FAILED");
    }
  }

  async verifyIdentityToken(
    identity_token: string,
    client_id: string,
    expected_nonce: string,
  ): Promise<VerifiedAppleIdentity> {
    try {
      const decoded_token = jwt.decode(identity_token, { complete: true });
      if (
        !decoded_token ||
        typeof decoded_token === "string" ||
        decoded_token.header.alg !== "RS256" ||
        typeof decoded_token.header.kid !== "string" ||
        decoded_token.header.kid.length === 0
      ) {
        throw new Error("invalid_header");
      }

      const public_key = await this.getApplePublicKey(decoded_token.header.kid);
      const verified_payload = jwt.verify(identity_token, public_key, {
        algorithms: ["RS256"],
        issuer: apple_issuer,
        audience: client_id,
        clockTolerance: apple_clock_tolerance_seconds,
      });
      if (typeof verified_payload === "string") {
        throw new Error("invalid_payload");
      }
      const payload = verified_payload as JwtPayload;
      const now_seconds = Math.floor(this.now().getTime() / 1000);
      if (
        typeof payload.sub !== "string" ||
        payload.sub.length === 0 ||
        typeof payload.exp !== "number" ||
        typeof payload.iat !== "number" ||
        payload.iat > now_seconds + apple_clock_tolerance_seconds ||
        typeof payload.nonce !== "string" ||
        payload.nonce !== expected_nonce
      ) {
        throw new Error("invalid_claims");
      }

      const email = typeof payload.email === "string" ? payload.email : null;
      return {
        subject: payload.sub,
        email,
        email_verified: isVerifiedEmailClaim(payload.email_verified),
        nonce: payload.nonce,
      };
    } catch (error) {
      if (error instanceof AppleAuthError) throw error;
      throw new AppleAuthError(
        "APPLE_INVALID_TOKEN",
        400,
        "Apple 인증 정보를 확인할 수 없습니다.",
      );
    }
  }

  private getPrivateKey(): string {
    if (this.private_key) return this.private_key;
    const private_key_path = getRequiredEnvironmentVariable(
      "APPLE_PRIVATE_KEY_PATH",
    );
    this.private_key = fs.readFileSync(private_key_path, "utf8");
    crypto.createPrivateKey(this.private_key);
    return this.private_key;
  }

  private async consumeChallenge(
    platform: OAuthLoginPlatform,
    state: string,
    nonce: string,
  ): Promise<ConsumedChallenge> {
    const rows = await sequelize.query<ConsumedChallenge>(
      `
        UPDATE oauth_login_challenges
        SET consumed_at = now()
        WHERE provider = 'APPLE'
          AND platform = :platform
          AND state_hash = :state_hash
          AND nonce_hash = :nonce_hash
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING challenge_id, client_id, redirect_uri
      `,
      {
        replacements: {
          platform,
          state_hash: hashCredential(state),
          nonce_hash: hashCredential(nonce),
        },
        type: QueryTypes.SELECT,
      },
    );
    if (rows.length !== 1) {
      throw new AppleAuthError(
        "APPLE_INVALID_CHALLENGE",
        400,
        "Apple 로그인 요청이 만료되었습니다. 다시 시도해주세요.",
      );
    }
    return rows[0];
  }

  private async exchangeAuthorizationCode(
    challenge: ConsumedChallenge,
    authorization_code: string,
  ): Promise<AppleTokenResponse> {
    const parameters = new URLSearchParams({
      client_id: challenge.client_id,
      client_secret: this.generateClientSecret(challenge.client_id),
      code: authorization_code,
      grant_type: "authorization_code",
    });
    if (challenge.redirect_uri) {
      parameters.set("redirect_uri", challenge.redirect_uri);
    }

    try {
      const response = await this.http_client.post<AppleTokenResponse>(
        apple_token_url,
        parameters.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: apple_http_timeout_ms,
        },
      );
      if (!response.data.id_token) {
        throw new Error("missing_id_token");
      }
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const upstream_error =
          typeof error.response?.data === "object" &&
          error.response?.data !== null &&
          "error" in error.response.data
            ? String((error.response.data as { error?: unknown }).error ?? "")
            : "";
        if (upstream_error === "invalid_grant") {
          throw new AppleAuthError(
            "APPLE_CODE_INVALID",
            400,
            "Apple 인증 코드가 만료되었거나 이미 사용되었습니다.",
          );
        }
      }
      throw new AppleAuthError(
        "APPLE_UPSTREAM_UNAVAILABLE",
        502,
        "Apple 인증 서버에 일시적으로 연결할 수 없습니다.",
      );
    }
  }

  private async getApplePublicKey(kid: string): Promise<KeyObject> {
    const now_ms = this.now().getTime();
    if (now_ms < this.jwks_expires_at_ms) {
      const cached_key = this.jwks_cache.get(kid);
      if (cached_key) return cached_key;
    }

    await this.refreshJwks();
    const refreshed_key = this.jwks_cache.get(kid);
    if (!refreshed_key) {
      throw new AppleAuthError(
        "APPLE_INVALID_TOKEN",
        400,
        "Apple 인증 정보를 확인할 수 없습니다.",
      );
    }
    return refreshed_key;
  }

  private async refreshJwks(): Promise<void> {
    if (this.jwks_refresh_promise) return this.jwks_refresh_promise;
    this.jwks_refresh_promise = (async () => {
      try {
        const response = await this.http_client.get<AppleJwksResponse>(
          apple_jwks_url,
          { timeout: apple_http_timeout_ms },
        );
        if (!Array.isArray(response.data.keys)) {
          throw new Error("invalid_jwks");
        }
        const refreshed_cache = new Map<string, KeyObject>();
        for (const jwk of response.data.keys) {
          if (
            typeof jwk.kid !== "string" ||
            jwk.kid.length === 0 ||
            jwk.kty !== "RSA" ||
            (jwk.alg !== undefined && jwk.alg !== "RS256")
          ) {
            continue;
          }
          refreshed_cache.set(
            jwk.kid,
            crypto.createPublicKey({ key: jwk, format: "jwk" }),
          );
        }
        if (refreshed_cache.size === 0) throw new Error("empty_jwks");

        const configured_cache_seconds = getPositiveIntegerEnvironmentVariable(
          "APPLE_JWKS_CACHE_SECONDS",
          21600,
        );
        const upstream_max_age = parseCacheMaxAgeSeconds(
          response.headers["cache-control"],
        );
        const effective_cache_seconds = Math.min(
          upstream_max_age ?? configured_cache_seconds,
          configured_cache_seconds,
          86400,
        );
        this.jwks_cache = refreshed_cache;
        this.jwks_expires_at_ms =
          this.now().getTime() + effective_cache_seconds * 1000;
      } catch (error) {
        if (error instanceof AppleAuthError) throw error;
        throw new AppleAuthError(
          "APPLE_UPSTREAM_UNAVAILABLE",
          502,
          "Apple 인증 서버에 일시적으로 연결할 수 없습니다.",
        );
      } finally {
        this.jwks_refresh_promise = null;
      }
    })();
    return this.jwks_refresh_promise;
  }

  private async lockAppleSubject(
    provider_subject: string,
    transaction: Transaction,
  ): Promise<void> {
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext(:lock_key))",
      {
        replacements: { lock_key: `shiftmate:apple:${provider_subject}` },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
  }

  private async persistAuthorization(
    user: User,
    provider_subject: string,
    client_id: string,
    encrypted_token: EncryptedAppleToken | null,
    transaction: Transaction,
  ): Promise<void> {
    const authorization = await OAuthAuthorization.findOne({
      where: {
        provider: "APPLE",
        provider_subject,
        client_id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (authorization && authorization.user_id !== user.user_id) {
      throw new Error("APPLE_AUTHORIZATION_USER_CONFLICT");
    }

    if (!encrypted_token) {
      if (!authorization || authorization.revoked_at !== null) {
        throw new AppleAuthError(
          "APPLE_REFRESH_TOKEN_UNAVAILABLE",
          400,
          "Apple 계정 연결 정보를 저장할 수 없습니다. 다시 시도해주세요.",
        );
      }
      return;
    }

    if (authorization) {
      authorization.refresh_token_ciphertext = encrypted_token.ciphertext;
      authorization.refresh_token_iv = encrypted_token.iv;
      authorization.refresh_token_auth_tag = encrypted_token.auth_tag;
      authorization.revoked_at = null;
      authorization.updated_at = this.now();
      await authorization.save({ transaction });
      return;
    }

    await OAuthAuthorization.create(
      {
        user_id: user.user_id,
        provider_subject,
        client_id,
        refresh_token_ciphertext: encrypted_token.ciphertext,
        refresh_token_iv: encrypted_token.iv,
        refresh_token_auth_tag: encrypted_token.auth_tag,
      },
      { transaction },
    );
  }

  private async cleanupOldChallenges(): Promise<void> {
    await sequelize.query(
      `
        DELETE FROM oauth_login_challenges
        WHERE challenge_id IN (
          SELECT challenge_id
          FROM oauth_login_challenges
          WHERE created_at < now() - interval '24 hours'
          ORDER BY created_at
          LIMIT 500
        )
      `,
      { type: QueryTypes.DELETE },
    );
  }
}

export const appleService = new AppleService();
