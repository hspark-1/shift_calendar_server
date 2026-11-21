import { randomUUID } from "node:crypto";
import { QueryTypes, Transaction, UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/database";
import { equalDigest, getPhoneConfig, getPhoneKeys, phoneDigest } from "../config/phoneVerification";
import { PhoneVerification, ProfileMutationReceipt, User } from "../models";
import { PhonePurpose } from "../models/PhoneVerification";
import { normalizeKoreanMobile } from "../utils/phone";
import { firebasePhoneTokenVerifier, PhoneTokenVerifier } from "./firebasePhoneTokenVerifier";
import { PhoneVerificationError } from "./phoneVerificationError";

const retention_ms = 24 * 60 * 60 * 1000;
const uuid_pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseIdempotencyKey(value: unknown, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !uuid_pattern.test(value)) throw new PhoneVerificationError(400, "VALIDATION_ERROR", "Idempotency-Key에 UUID가 필요합니다.");
  return value.toLowerCase();
}

export function assertPhoneAccount(user: User | null): asserts user is User {
  if (!user) throw new PhoneVerificationError(401, "UNAUTHORIZED", "인증이 필요합니다.");
  if (user.account_status !== "ACTIVE") throw new PhoneVerificationError(409, "ACCOUNT_DELETION_IN_PROGRESS", "회원 탈퇴가 처리 중입니다.");
}

function assertPurpose(user: User, purpose: PhonePurpose): void {
  if ((user.profile_completed_at == null) !== (purpose === "SIGNUP")) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_PURPOSE_INVALID");
}

export async function assertPhoneAvailable(phone: string, user_id: string, transaction: Transaction): Promise<void> {
  const owner = await User.findOne({ where: { phone }, attributes: ["user_id"], transaction });
  if (owner && owner.user_id !== user_id) throw new PhoneVerificationError(409, "PHONE_ALREADY_EXISTS", "이미 사용 중인 전화번호입니다.");
}

function assertLive(challenge: PhoneVerification | null, proof = false): asserts challenge is PhoneVerification {
  if (!challenge || challenge.cancelled_at) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
  if (proof && challenge.consumed_at) throw new PhoneVerificationError(409, "PHONE_VERIFICATION_USED");
  const expiry = proof ? challenge.proof_expires_at : challenge.expires_at;
  if (!expiry) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
  if (expiry.getTime() <= Date.now()) throw new PhoneVerificationError(410, proof ? "PHONE_VERIFICATION_EXPIRED" : "PHONE_CHALLENGE_EXPIRED");
}

function proofToken(challenge: PhoneVerification): string {
  if (!challenge.proof_id || !challenge.proof_key_version) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
  return `${challenge.proof_id}.${phoneDigest("proof", [challenge.challenge_id, challenge.user_id, challenge.phone_e164, challenge.purpose, challenge.generation, challenge.proof_id], challenge.proof_key_version)}`;
}

function challengeResponse(challenge: PhoneVerification) {
  return { challenge_id: String(challenge.challenge_id), phone: challenge.phone.replace(/-/g, ""), phone_e164: challenge.phone_e164, purpose: challenge.purpose, server_now: new Date().toISOString(), expires_at: challenge.expires_at.toISOString() };
}
function proofResponse(challenge: PhoneVerification) {
  return { phone_verification_token: proofToken(challenge), phone: challenge.phone.replace(/-/g, ""), purpose: challenge.purpose, server_now: new Date().toISOString(), expires_at: challenge.proof_expires_at!.toISOString() };
}

export async function enforcePhoneRateLimit(user_id: string, ip: string, operation: "challenge" | "exchange"): Promise<void> {
  const config = getPhoneConfig();
  const window_seconds = operation === "challenge" ? 3600 : 600;
  const now = Date.now();
  const window_start = new Date(Math.floor(now / (window_seconds * 1000)) * window_seconds * 1000);
  const expires_at = new Date(window_start.getTime() + window_seconds * 1000);
  const scopes = [
    { scope: "user", value: user_id, max: operation === "challenge" ? config.challenge_user_limit : config.exchange_user_limit },
    { scope: "ip", value: ip, max: operation === "challenge" ? config.challenge_ip_limit : config.exchange_ip_limit },
  ];
  // Count every active key alias so rolling key rotation cannot bypass limits.
  const counters = scopes.flatMap((scope) => Object.keys(getPhoneKeys().keys).map((version) => ({ ...scope, hash: phoneDigest("rate-limit", [operation, scope.scope, scope.value], version) }))).sort((a, b) => a.hash.localeCompare(b.hash));
  const exceeded = await sequelize.transaction(async (transaction) => {
    let exceeded = false;
    for (const counter of counters) {
      const rows = await sequelize.query<{ hits: number }>(`INSERT INTO phone_verification_rate_limits(scope_hash, window_start, hits, expires_at)
        VALUES (:scope_hash, :window_start, 1, :expires_at)
        ON CONFLICT (scope_hash, window_start) DO UPDATE SET hits = LEAST(phone_verification_rate_limits.hits + 1, :max_hits + 1)
        RETURNING hits`, { replacements: { scope_hash: counter.hash, window_start, expires_at, max_hits: counter.max }, type: QueryTypes.SELECT, transaction });
      if (rows[0].hits > counter.max) exceeded = true;
    }
    return exceeded;
  });
  if (exceeded) throw new PhoneVerificationError(429, "PHONE_VERIFICATION_RATE_LIMITED", "휴대폰 인증 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", Math.max(1, Math.ceil((expires_at.getTime() - now) / 1000)));
}

export class PhoneVerificationService {
  constructor(private readonly verifier: PhoneTokenVerifier = firebasePhoneTokenVerifier) {}

  async createChallenge(user_id: string, input: { phone: unknown; purpose: unknown }, idempotency_key: string) {
    const phone = normalizeKoreanMobile(input.phone);
    if (!phone) throw new PhoneVerificationError(400, "INVALID_PHONE", "유효한 국내 휴대폰 번호가 필요합니다.");
    if (input.purpose !== "SIGNUP" && input.purpose !== "PHONE_CHANGE") throw new PhoneVerificationError(400, "PHONE_VERIFICATION_PURPOSE_INVALID");
    const purpose = input.purpose;
    const key = parseIdempotencyKey(idempotency_key)!;
    const payload = [phone.e164, purpose];
    return sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(user_id, { transaction, lock: transaction.LOCK.UPDATE });
      assertPhoneAccount(user);
      const existing = await PhoneVerification.findOne({ where: { user_id, challenge_key: key }, transaction, lock: transaction.LOCK.UPDATE });
      if (existing) {
        if (!equalDigest(existing.challenge_fingerprint, phoneDigest("challenge-request", payload, existing.fingerprint_key_version))) throw new PhoneVerificationError(409, "IDEMPOTENCY_KEY_REUSED");
        // Recover only a usable session. A prior key must never revive an old flow.
        assertLive(existing);
        if (existing.consumed_at) throw new PhoneVerificationError(409, "PHONE_VERIFICATION_USED");
        if (existing.verified_at) assertLive(existing, true);
        assertPurpose(user, existing.purpose);
        await assertPhoneAvailable(existing.phone, user_id, transaction);
        return challengeResponse(existing);
      }
      assertPurpose(user, purpose);
      await assertPhoneAvailable(phone.phone, user_id, transaction);
      const [state] = await sequelize.query<{ generation: string }>("UPDATE users SET phone_verification_generation = phone_verification_generation + 1 WHERE user_id = :user_id RETURNING phone_verification_generation AS generation", { replacements: { user_id }, type: QueryTypes.SELECT, transaction });
      const generation = String(state.generation);
      const now = new Date();
      const expires_at = new Date(now.getTime() + getPhoneConfig().challenge_ttl * 1000);
      await PhoneVerification.update({ cancelled_at: now }, { where: { user_id, cancelled_at: null }, transaction });
      const challenge = await PhoneVerification.create({ user_id, purpose, phone: phone.phone, phone_e164: phone.e164, generation, created_at: now, expires_at, retained_until: new Date(expires_at.getTime() + retention_ms), challenge_key: key, challenge_fingerprint: phoneDigest("challenge-request", payload), fingerprint_key_version: getPhoneKeys().current }, { transaction });
      return challengeResponse(challenge);
    });
  }

  async verify(user_id: string, challenge_id: string, token: string, idempotency_key: string) {
    const key = parseIdempotencyKey(idempotency_key)!;
    if (typeof challenge_id !== "string" || !uuid_pattern.test(challenge_id)) throw new PhoneVerificationError(400, "VALIDATION_ERROR");
    // No transaction/row lock is held during Firebase signature/revocation I/O.
    const preliminary = await PhoneVerification.findOne({ where: { challenge_id, user_id } });
    assertLive(preliminary, Boolean(preliminary?.verified_at));
    const identity = await this.verifier.verify(token);
    const payload = [identity.project_id, identity.uid, identity.auth_time, identity.phone_e164, challenge_id.toLowerCase()];
    try {
      return await sequelize.transaction(async (transaction) => {
        const user = await User.findByPk(user_id, { transaction, lock: transaction.LOCK.UPDATE });
        assertPhoneAccount(user);
        const challenge = await PhoneVerification.findOne({ where: { challenge_id, user_id }, transaction, lock: transaction.LOCK.UPDATE });
        if (!challenge) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
        const existing = await PhoneVerification.findOne({ where: { user_id, verify_key: key }, transaction });
        if (existing) {
          if (!existing.verify_fingerprint || !equalDigest(existing.verify_fingerprint, phoneDigest("verify-request", payload, existing.fingerprint_key_version))) throw new PhoneVerificationError(409, "IDEMPOTENCY_KEY_REUSED");
          assertLive(existing, true);
          return proofResponse(existing);
        }
        assertLive(challenge);
        assertPurpose(user, challenge.purpose);
        if (challenge.verified_at) throw new PhoneVerificationError(409, "PHONE_FIREBASE_AUTH_REUSED");
        if (identity.project_id !== getPhoneConfig().project_id || identity.phone_e164 !== challenge.phone_e164) throw new PhoneVerificationError(400, "PHONE_FIREBASE_TOKEN_INVALID");
        const { auth_max_age, clock_skew } = getPhoneConfig();
        const now = new Date();
        if (Math.floor(now.getTime() / 1000) - identity.auth_time > auth_max_age || identity.auth_time < Math.floor(challenge.created_at.getTime() / 1000) - clock_skew) throw new PhoneVerificationError(410, "PHONE_FIREBASE_AUTH_TOO_OLD");
        await assertPhoneAvailable(challenge.phone, user_id, transaction);
        const event_hashes = Object.keys(getPhoneKeys().keys).map((version) => phoneDigest("firebase-event", [identity.project_id, identity.uid, identity.auth_time], version)).sort();
        // Unique claims for all key aliases are atomic and serialize cross-user races.
        for (const event_hash of event_hashes) {
          const inserted = await sequelize.query<{ event_hash: string }>("INSERT INTO phone_verification_events(event_hash, retained_until) VALUES (:event_hash, :retained_until) ON CONFLICT DO NOTHING RETURNING event_hash", { replacements: { event_hash, retained_until: new Date(now.getTime() + retention_ms) }, type: QueryTypes.SELECT, transaction });
          if (inserted.length === 0) throw new PhoneVerificationError(409, "PHONE_FIREBASE_AUTH_REUSED");
        }
        challenge.verify_key = key;
        challenge.verify_fingerprint = phoneDigest("verify-request", payload, challenge.fingerprint_key_version);
        challenge.verified_at = now;
        challenge.proof_id = randomUUID();
        challenge.proof_key_version = getPhoneKeys().current;
        challenge.proof_expires_at = new Date(now.getTime() + getPhoneConfig().proof_ttl * 1000);
        challenge.retained_until = new Date(Math.max(challenge.retained_until.getTime(), challenge.proof_expires_at.getTime() + retention_ms));
        challenge.proof_token_hash = phoneDigest("proof-digest", proofToken(challenge), challenge.proof_key_version);
        await challenge.save({ transaction });
        return proofResponse(challenge);
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw new PhoneVerificationError(409, "PHONE_FIREBASE_AUTH_REUSED");
      throw error;
    }
  }
}

export async function consumePhoneProof(user: User, phone: string, purpose: PhonePurpose, token: unknown, transaction: Transaction): Promise<string> {
  if (token === undefined) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_REQUIRED");
  if (typeof token !== "string" || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token) || !uuid_pattern.test(token.split(".")[0])) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
  const challenge = await PhoneVerification.findOne({ where: { proof_id: token.split(".")[0], user_id: user.user_id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!challenge || !challenge.proof_key_version || !challenge.proof_token_hash || !equalDigest(challenge.proof_token_hash, phoneDigest("proof-digest", token, challenge.proof_key_version))) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
  // A consumed proof in a new mutation always fails, including unchanged phone.
  if (challenge.consumed_at) throw new PhoneVerificationError(409, "PHONE_VERIFICATION_USED");
  assertLive(challenge, true);
  if (challenge.phone !== phone || challenge.purpose !== purpose) throw new PhoneVerificationError(400, "PHONE_VERIFICATION_INVALID");
  assertPurpose(user, purpose);
  challenge.consumed_at = new Date();
  await challenge.save({ transaction });
  user.phone_verified_at = challenge.consumed_at;
  return challenge.challenge_id;
}

export interface ProfileMutationContext { idempotency_key?: string; payload: unknown; operation: "COMPLETE" | "UPDATE" }
export async function findProfileReceipt(user_id: string, context: ProfileMutationContext | undefined, transaction?: Transaction): Promise<boolean> {
  if (!context?.idempotency_key) return false;
  const receipt = await ProfileMutationReceipt.findOne({ where: { user_id, idempotency_key: context.idempotency_key }, transaction });
  if (!receipt) return false;
  if (receipt.operation !== context.operation || !equalDigest(receipt.request_fingerprint, phoneDigest("profile-request", context.payload, receipt.fingerprint_key_version))) throw new PhoneVerificationError(409, "IDEMPOTENCY_KEY_REUSED");
  return true;
}

export async function createProfileReceipt(user_id: string, context: ProfileMutationContext | undefined, verification_id: string | null, transaction: Transaction): Promise<void> {
  if (!context?.idempotency_key) return;
  const created_at = new Date();
  await ProfileMutationReceipt.create({ user_id, idempotency_key: context.idempotency_key, operation: context.operation, request_fingerprint: phoneDigest("profile-request", context.payload), fingerprint_key_version: getPhoneKeys().current, verification_id, created_at, retained_until: new Date(created_at.getTime() + retention_ms) }, { transaction });
}

export const phoneVerificationService = new PhoneVerificationService();

export async function cleanupPhoneVerificationData(): Promise<void> {
  // Bounded deletes avoid long transactions; expired claims outlive max auth freshness.
  await sequelize.transaction(async (transaction) => {
    for (const [table, column] of [["profile_mutation_receipts", "retained_until"], ["phone_verifications", "retained_until"], ["phone_verification_events", "retained_until"], ["phone_verification_rate_limits", "expires_at"]]) {
      await sequelize.query(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${column} < now() LIMIT 1000 FOR UPDATE SKIP LOCKED)`, { transaction });
    }
  });
}
