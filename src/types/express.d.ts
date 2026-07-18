import { User } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      request_id?: string;
    }
  }
}

export {};
