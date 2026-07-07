import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models";

interface JwtPayload {
  user_id: string; // UUID
  email: string;
}

// Express Request에 user 속성 추가 타입
interface AuthenticatedRequest extends Request {
  user?: User;
}

function sendUnauthorizedResponse(res: Response): void {
  res.status(401).json({
    success: false,
    message: "로그인이 필요합니다.",
    error: {
      code: "UNAUTHORIZED",
      message: "로그인이 필요합니다.",
    },
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
      sendUnauthorizedResponse(res);
      return;
    }

    const token = auth_header.split(" ")[1];
    const jwt_secret = process.env.JWT_SECRET || "default_secret";

    const decoded = jwt.verify(token, jwt_secret) as JwtPayload;

    const user = await User.findByPk(decoded.user_id);

    if (!user) {
      sendUnauthorizedResponse(res);
      return;
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      sendUnauthorizedResponse(res);
      return;
    }
    sendUnauthorizedResponse(res);
  }
}
