import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.js";
import { COOKIE_NAME } from "../web/api/auth.js";

/** Parse cookies from Cookie header string */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

export function createRequireAuth(secret: string) {
  return function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    // 1. Try Authorization header (API compatibility)
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    // 2. Fallback to cookie
    if (!token) {
      const cookies = parseCookies(req.headers.cookie);
      token = cookies[COOKIE_NAME];
    }

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payload = verifyToken(token, secret);
    if (!payload) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    (req as any).auth = payload;
    next();
  };
}

export function createRequireAdmin(secret: string) {
  const requireAuth = createRequireAuth(secret);
  return function requireAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    requireAuth(req, res, () => {
      const auth = (req as any).auth as { role: string } | undefined;
      if (auth?.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    });
  };
}
