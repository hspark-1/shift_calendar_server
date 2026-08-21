import { User } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      request_id?: string;
      auth_context?: {
        auth_time: number | null;
        issued_at: number | null;
      };
      validated_profile_image?: {
        buffer: Buffer;
        content_type: "image/jpeg" | "image/png" | "image/webp";
        extension: "jpg" | "png" | "webp";
      };
    }
  }
}

export {};
