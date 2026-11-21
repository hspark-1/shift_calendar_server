import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { DecodedIdToken, getAuth } from "firebase-admin/auth";
import { getPhoneConfig, validatePhoneVerificationEnvironment } from "../config/phoneVerification";
import { normalizeFirebasePhone } from "../utils/phone";
import { PhoneVerificationError, phoneUnavailable } from "./phoneVerificationError";

export interface VerifiedPhoneIdentity { project_id: string; uid: string; auth_time: number; phone_e164: string }
export interface PhoneTokenVerifier { verify(token: string): Promise<VerifiedPhoneIdentity> }
type AdminAuth = { verifyIdToken(token: string, check_revoked: boolean): Promise<DecodedIdToken> };

export class FirebasePhoneTokenVerifier implements PhoneTokenVerifier {
  private admin_auth?: AdminAuth;
  constructor(admin_auth?: AdminAuth) { this.admin_auth = admin_auth; }

  initialize(): void {
    validatePhoneVerificationEnvironment();
    const { project_id } = getPhoneConfig();
    const app_name = `shiftmate-phone-auth-${project_id}`;
    const firebase_app = getApps().find((app) => app.name === app_name) ?? initializeApp({ projectId: project_id, credential: applicationDefault() }, app_name);
    this.admin_auth = getAuth(firebase_app);
  }

  async verify(token: string): Promise<VerifiedPhoneIdentity> {
    if (typeof token !== "string" || token.length < 1 || token.length > 16384) throw new PhoneVerificationError(400, "PHONE_FIREBASE_TOKEN_INVALID");
    let claims: DecodedIdToken;
    try {
      if (!this.admin_auth) this.initialize();
      claims = await this.admin_auth!.verifyIdToken(token, true);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : "";
      // Admin 13.10.0 also maps certificate-fetch failures to argument-error.
      // Only known SDK token-validation prefixes are a client token error;
      // an unknown argument-error (including key-fetch failure) remains a 503.
      if (code === "auth/argument-error" || code === "auth/invalid-argument") {
        if (/^(Firebase ID token |Decoding Firebase ID token failed\.|verifyIdToken\(\) expects |First argument to verifyIdToken\(\))/.test(message)) throw new PhoneVerificationError(400, "PHONE_FIREBASE_TOKEN_INVALID");
        throw phoneUnavailable();
      }
      const invalid_codes = ["auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found", "auth/tenant-id-mismatch"];
      if (code && invalid_codes.includes(code)) throw new PhoneVerificationError(400, "PHONE_FIREBASE_TOKEN_INVALID");
      // Certificate fetch, ADC/IAM and Auth lookup failures fail closed with 503.
      throw phoneUnavailable();
    }
    const { project_id, clock_skew } = getPhoneConfig();
    const phone = normalizeFirebasePhone(claims.phone_number);
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== project_id || claims.iss !== `https://securetoken.google.com/${project_id}` || claims.firebase?.sign_in_provider !== "phone" || claims.firebase?.tenant || typeof claims.uid !== "string" || !claims.uid.trim() || claims.uid !== claims.sub || !phone || !Number.isSafeInteger(claims.auth_time) || claims.auth_time <= 0 || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.iat > now + clock_skew || claims.auth_time > now + clock_skew || claims.auth_time > claims.iat + clock_skew) {
      throw new PhoneVerificationError(400, "PHONE_FIREBASE_TOKEN_INVALID");
    }
    return { project_id, uid: claims.uid, auth_time: claims.auth_time, phone_e164: phone.e164 };
  }
}

export const firebasePhoneTokenVerifier = new FirebasePhoneTokenVerifier();
