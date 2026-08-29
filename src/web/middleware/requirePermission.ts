import type { Request, Response, NextFunction, RequestHandler } from "express";

// Generic over the route-param shape (`P`) so Express can keep inferring
// `req.params` from the route string (e.g. `/:id` → `{ id: string }`) when
// these are passed as a per-route middleware argument. Pinning the default
// `ParamsDictionary` here would otherwise force the broad
// `string | string[]` param overload on every route they guard.
export function requirePermission<P = Record<string, string>>(capability: string): RequestHandler<P> {
  return (req: Request<P>, res: Response, next: NextFunction) => {
    if (!req.user) { res.status(401).json({ error: "请先登录" }); return; }
    if (req.user.role === "admin" || req.user.capabilities?.has(capability)) { next(); return; }
    res.status(403).json({ error: "权限不足：没有执行此操作的权限，请联系管理员" });
  };
}

export function requireBotAccess<P = Record<string, string>>(paramName = "botId"): RequestHandler<P> {
  return (req: Request<P>, res: Response, next: NextFunction) => {
    if (!req.user) { res.status(401).json({ error: "请先登录" }); return; }
    const botId = (req.params as Record<string, string | undefined>)[paramName];
    if (typeof botId === "string" && canAccessBot(req.user, botId)) { next(); return; }
    res.status(403).json({ error: "权限不足：你没有访问该机器人的权限，请联系管理员" });
  };
}

/** Body-based counterpart of requireBotAccess for routes whose botId comes
 *  from the request body rather than a URL param (e.g. saved-queues). */
export function canAccessBot(
  user: { role: "admin" | "member" | "guest"; bots?: "all" | Set<string> } | undefined,
  botId: string,
): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.bots === "all") return true;
  return user.bots instanceof Set && user.bots.has(botId);
}
