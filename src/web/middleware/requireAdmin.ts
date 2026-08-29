import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "该操作仅管理员可执行" });
    return;
  }
  next();
}
