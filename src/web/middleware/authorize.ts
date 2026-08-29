import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { GuestFlag } from "../../data/permissions.js";

/**
 * Unified authorization gate.
 * - admin  → always allowed (unchanged from requirePermission)
 * - member → allowed iff it holds `capability` (unchanged from requirePermission)
 * - guest  → allowed iff `guestFlag` is set AND that flag is enabled in the
 *            guest's resolved permissions; a route with no `guestFlag` is
 *            denied to guests by default.
 * Generic over the route-param shape `P` for the same reason requirePermission is.
 */
export function authorize<P = Record<string, string>>(opts: {
  capability?: string;
  guestFlag?: GuestFlag;
}): RequestHandler<P> {
  return (req: Request<P>, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) { res.status(401).json({ error: "请先登录" }); return; }
    if (user.role === "admin") { next(); return; }
    if (user.role === "guest") {
      if (opts.guestFlag && user.guest?.[opts.guestFlag] === true) { next(); return; }
      res.status(403).json({ error: "游客权限不足：该操作未对游客开放，请联系管理员开启" });
      return;
    }
    if (opts.capability && user.capabilities?.has(opts.capability)) { next(); return; }
    res.status(403).json({ error: "权限不足：没有执行此操作的权限，请联系管理员" });
  };
}
