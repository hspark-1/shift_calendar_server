import { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
  status_code?: number;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('❌ Error:', err);

  const status_code = err.status_code || 500;
  const message = err.message || '서버 내부 오류가 발생했습니다.';

  res.status(status_code).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

