import { Request, Response } from "express";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { User } from "../models";
import { readProfileImage } from "../services/profileImageStorageService";
import { isOwnedProfileImageKey, legacyProfileImageKey } from "../utils/profileImageLocation";
import { logError } from "../utils/logger";

export async function getProfileImage(req: Request, res: Response): Promise<void> {
  const user_id = req.params.user_id;
  const abort_controller = new AbortController();
  const timeout = setTimeout(() => abort_controller.abort(), 10000);
  timeout.unref();
  const onClose = (): void => abort_controller.abort();
  res.once("close", onClose);
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("Authorization");
  try {
    const user = await User.findOne({
      where: { user_id, account_status: "ACTIVE" },
      attributes: ["user_id", "profile_image_key", "profile_image_url"],
    });
    const key = user?.profile_image_key ??
      (user?.profile_image_url ? legacyProfileImageKey(user.profile_image_url, user_id) : null);
    if (!key || !isOwnedProfileImageKey(key, user_id)) {
      res.status(404).json({ success: false, error: { code: "PROFILE_IMAGE_NOT_FOUND", message: "프로필 이미지를 찾을 수 없습니다." }, request_id: req.request_id });
      return;
    }
    const object = await readProfileImage(user_id, key, abort_controller.signal);
    const body = object.Body;
    const allowed_types = ["image/jpeg", "image/png", "image/webp"];
    const max_bytes = 5 * 1024 * 1024;
    if (!(body instanceof Readable) || !object.ContentType || !allowed_types.includes(object.ContentType) ||
        (object.ContentLength !== undefined && (object.ContentLength < 1 || object.ContentLength > max_bytes))) {
      if (body instanceof Readable) body.destroy();
      throw new Error("INVALID_PROFILE_IMAGE_OBJECT");
    }
    res.setHeader("Content-Type", object.ContentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (object.ContentLength !== undefined) res.setHeader("Content-Length", object.ContentLength);
    let byte_count = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byte_count += chunk.length;
        callback(byte_count > max_bytes ? new Error("PROFILE_IMAGE_TOO_LARGE") : null, chunk);
      },
    });
    await pipeline(body, limiter, res, { signal: abort_controller.signal });
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    res.removeHeader("Content-Length");
    const is_missing = error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name);
    if (!is_missing) logError("profile_image_read_failed", error, req.request_id);
    res.status(is_missing ? 404 : 503).json({
      success: false,
      error: { code: is_missing ? "PROFILE_IMAGE_NOT_FOUND" : "PROFILE_IMAGE_STORAGE_UNAVAILABLE",
        message: is_missing ? "프로필 이미지를 찾을 수 없습니다." : "프로필 이미지를 불러올 수 없습니다." },
      request_id: req.request_id,
    });
  } finally {
    clearTimeout(timeout);
    res.removeListener("close", onClose);
  }
}
