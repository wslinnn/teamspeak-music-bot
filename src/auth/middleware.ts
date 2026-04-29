import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "./jwt.js";

/**
 * Create an Express middleware that requires a valid JWT
 * in the Authorization: Bearer header.
 */
export function createRequireAuth(secret: string) {
  return function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
      return;
    }

    const token = header.slice(7);
    try {
      const payload: JwtPayload = verifyToken(token, secret);
      (req as Request & { user: JwtPayload }).user = payload;
      next();
    } catch {
      res.status(401).json({ success: false, error: "Invalid or expired token" });
    }
  };
}

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
  }
}
