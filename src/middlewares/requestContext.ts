import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

const valid_request_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incoming_request_id = req.header("X-Request-ID");
  const request_id =
    incoming_request_id && valid_request_id_pattern.test(incoming_request_id)
      ? incoming_request_id
      : crypto.randomUUID();

  req.request_id = request_id;
  res.setHeader("X-Request-ID", request_id);
  next();
}
