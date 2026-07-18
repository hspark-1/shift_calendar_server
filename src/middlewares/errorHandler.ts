import { NextFunction, Request, Response } from "express";
import { logError } from "../utils/logger";

interface AppError extends Error {
  status?: number;
  status_code?: number;
  type?: string;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logError("unhandled_request_error", err, req.request_id);

  const status_code = err.status_code || err.status || 500;
  const is_production = process.env.NODE_ENV === "production";
  const message =
    is_production && status_code >= 500
      ? "서버 내부 오류가 발생했습니다."
      : err.message || "서버 내부 오류가 발생했습니다.";

  res.status(status_code).json({
    success: false,
    message,
    request_id: req.request_id,
    ...(!is_production && { stack: err.stack }),
  });
}
