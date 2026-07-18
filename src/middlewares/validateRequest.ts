import { NextFunction, Request, Response } from "express";
import { validationResult } from "express-validator";

export function validateRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const validation_errors = errors.array().map((error) => ({
      type: error.type,
      field: "path" in error ? error.path : undefined,
      location: "location" in error ? error.location : undefined,
      message: error.msg,
    }));

    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값 검증에 실패했습니다.",
      },
      errors: validation_errors,
      request_id: req.request_id,
    });
    return;
  }

  next();
}
