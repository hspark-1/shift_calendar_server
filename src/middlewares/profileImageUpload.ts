import { NextFunction, Request, Response } from "express";
import multer from "multer";

export const profile_image_max_bytes = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: profile_image_max_bytes,
    files: 1,
    fields: 8,
    parts: 9,
  },
});

type DetectedImage = NonNullable<Request["validated_profile_image"]>;

function isPng(buffer: Buffer): boolean {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) return false;
  let offset = 8;
  let saw_ihdr = false;
  let saw_idat = false;
  while (offset + 12 <= buffer.length) {
    const chunk_length = buffer.readUInt32BE(offset);
    const chunk_type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk_end = offset + 12 + chunk_length;
    if (chunk_end > buffer.length) return false;
    if (!saw_ihdr) {
      if (chunk_type !== "IHDR" || chunk_length !== 13) return false;
      if (buffer.readUInt32BE(offset + 8) === 0 || buffer.readUInt32BE(offset + 12) === 0) {
        return false;
      }
      saw_ihdr = true;
    }
    if (chunk_type === "IDAT") saw_idat = true;
    if (chunk_type === "IEND") {
      return chunk_length === 0 && saw_idat && chunk_end === buffer.length;
    }
    offset = chunk_end;
  }
  return false;
}

function isJpeg(buffer: Buffer): boolean {
  if (
    buffer.length < 12 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    return false;
  }

  const start_of_frame_markers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  let saw_start_of_frame = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length - 2) return false;
    const segment_length = buffer.readUInt16BE(offset);
    if (segment_length < 2 || offset + segment_length > buffer.length - 2) {
      return false;
    }
    if (start_of_frame_markers.has(marker)) {
      if (
        segment_length < 8 ||
        buffer.readUInt16BE(offset + 3) === 0 ||
        buffer.readUInt16BE(offset + 5) === 0
      ) {
        return false;
      }
      saw_start_of_frame = true;
    }
    if (marker === 0xda) {
      return saw_start_of_frame;
    }
    offset += segment_length;
  }
  return false;
}

function isWebp(buffer: Buffer): boolean {
  if (!(
    buffer.length >= 20 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.readUInt32LE(4) + 8 === buffer.length &&
    buffer.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16))
  )) {
    return false;
  }
  const first_chunk_length = buffer.readUInt32LE(16);
  return 20 + first_chunk_length + (first_chunk_length % 2) <= buffer.length;
}

export function detectProfileImage(buffer: Buffer): DetectedImage | null {
  if (isJpeg(buffer)) {
    return { buffer, content_type: "image/jpeg", extension: "jpg" };
  }
  if (isPng(buffer)) {
    return { buffer, content_type: "image/png", extension: "png" };
  }
  if (isWebp(buffer)) {
    return { buffer, content_type: "image/webp", extension: "webp" };
  }
  return null;
}

function sendUploadError(
  req: Request,
  res: Response,
  status_code: number,
  code: string,
  message: string,
): void {
  res.status(status_code).json({
    success: false,
    error: { code, message },
    request_id: req.request_id,
  });
}

export function profileImageUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }

  upload.single("profile_image")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        sendUploadError(
          req,
          res,
          413,
          "PROFILE_IMAGE_TOO_LARGE",
          "프로필 이미지는 5MB 이하여야 합니다.",
        );
        return;
      }
      sendUploadError(
        req,
        res,
        400,
        "INVALID_PROFILE_IMAGE",
        "프로필 이미지는 profile_image 파일 1개만 전송할 수 있습니다.",
      );
      return;
    }
    if (error) {
      next(error);
      return;
    }
    if (!req.file) {
      next();
      return;
    }

    const detected_image = detectProfileImage(req.file.buffer);
    if (!detected_image || req.file.mimetype !== detected_image.content_type) {
      sendUploadError(
        req,
        res,
        400,
        "INVALID_PROFILE_IMAGE",
        "JPEG, PNG, WebP 형식의 정상 이미지 파일만 허용합니다.",
      );
      return;
    }
    req.validated_profile_image = detected_image;
    next();
  });
}
