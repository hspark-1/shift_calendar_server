import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models";
import { getRequiredEnvironmentVariable } from "../config/environment";

interface JwtPayload {
  user_id: string; // UUID
  email: string;
  auth_time?: number;
  iat?: number;
}

// Express Request에 user 속성 추가 타입
interface AuthenticatedRequest extends Request {
  user?: User;
}

function sendUnauthorizedResponse(req: Request, res: Response): void {
  res.status(401).json({
    success: false,
    message: "로그인이 필요합니다.",
    error: {
      code: "UNAUTHORIZED",
      message: "로그인이 필요합니다.",
    },
    request_id: req.request_id,
  });
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth_header = req.headers.authorization;

    if (!auth_header || !auth_header.startsWith("Bearer ")) {
      sendUnauthorizedResponse(req, res);
      return;
    }

    const token = auth_header.split(" ")[1];
    const jwt_secret = getRequiredEnvironmentVariable("JWT_SECRET");

    const decoded = jwt.verify(token, jwt_secret) as JwtPayload;

    const user = await User.findByPk(decoded.user_id);

    if (!user) {
      sendUnauthorizedResponse(req, res);
      return;
    }

    if (user.account_status !== "ACTIVE") {
      res.status(409).json({
        success: false,
        error: {
          code: "ACCOUNT_DELETION_IN_PROGRESS",
          message: "회원 탈퇴가 처리 중입니다.",
        },
        request_id: req.request_id,
      });
      return;
    }

    (req as AuthenticatedRequest).user = user;
    req.auth_context = {
      auth_time:
        typeof decoded.auth_time === "number" ? decoded.auth_time : null,
      issued_at: typeof decoded.iat === "number" ? decoded.iat : null,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      sendUnauthorizedResponse(req, res);
      return;
    }
    sendUnauthorizedResponse(req, res);
  }
}

export async function accountDeletionStatusAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth_header = req.headers.authorization;
    if (!auth_header || !auth_header.startsWith("Bearer ")) {
      sendUnauthorizedResponse(req, res);
      return;
    }
    const decoded = jwt.verify(
      auth_header.split(" ")[1],
      getRequiredEnvironmentVariable("JWT_SECRET"),
    ) as JwtPayload;
    const user = await User.findByPk(decoded.user_id);
    if (!user || user.account_status !== "DELETION_PENDING") {
      sendUnauthorizedResponse(req, res);
      return;
    }
    req.user = user;
    req.auth_context = {
      auth_time:
        typeof decoded.auth_time === "number" ? decoded.auth_time : null,
      issued_at: typeof decoded.iat === "number" ? decoded.iat : null,
    };
    next();
  } catch {
    sendUnauthorizedResponse(req, res);
  }
}
