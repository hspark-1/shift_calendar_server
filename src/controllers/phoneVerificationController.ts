import { Request, Response } from "express";
import { enforcePhoneRateLimit, parseIdempotencyKey, phoneVerificationService } from "../services/phoneVerificationService";
import { PhoneVerificationError, phoneUnavailable } from "../services/phoneVerificationError";
import { logError } from "../utils/logger";

async function handlePhoneRequest(req: Request, res: Response, operation: "challenge" | "exchange"): Promise<void> {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (!req.user) throw new PhoneVerificationError(401, "UNAUTHORIZED", "인증이 필요합니다.");
    const key = parseIdempotencyKey(req.headers["idempotency-key"])!;
    await enforcePhoneRateLimit(req.user.user_id, req.ip || req.socket.remoteAddress || "unknown", operation);
    const data = operation === "challenge"
      ? await phoneVerificationService.createChallenge(req.user.user_id, req.body, key)
      : await phoneVerificationService.verify(req.user.user_id, req.body.challenge_id, req.body.firebase_id_token, key);
    res.json({ success: true, data, request_id: req.request_id });
  } catch (error) {
    const safe_error = error instanceof PhoneVerificationError ? error : phoneUnavailable();
    // Only stable app codes, never SDK/SQL/token/phone/UID details.
    logError(`phone_${operation}_failed`, safe_error, req.request_id);
    if (safe_error.retry_after_seconds) res.setHeader("Retry-After", safe_error.retry_after_seconds);
    res.status(safe_error.status_code).json({ success: false, error: { code: safe_error.code, message: safe_error.message, ...(safe_error.retry_after_seconds ? { retry_after_seconds: safe_error.retry_after_seconds } : {}) }, request_id: req.request_id });
  }
}

export async function createPhoneChallenge(req: Request, res: Response): Promise<void> { await handlePhoneRequest(req, res, "challenge"); }
export async function verifyPhoneChallenge(req: Request, res: Response): Promise<void> { await handlePhoneRequest(req, res, "exchange"); }
