import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.js";

export function createRequireAuth(secret: string) {
  return function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = authHeader.slice(7);
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
