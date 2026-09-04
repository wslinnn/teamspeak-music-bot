import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { SessionStore, SessionValidation } from "../../data/sessions.js";
import { SESSION_TTL_MS } from "../../data/sessions.js";
import type { ClientTokenStore } from "../../data/client-tokens.js";
import { resolvePermissionContext, type PermissionStore, type GuestPermissions } from "../../data/permissions.js";
import type { GuestModeConfig } from "../../data/config.js";
import {
  validateSessionFromHeaders,
  extractSessionToken,
  SESSION_COOKIE_NAME,
} from "../auth/validateSession.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      username: string;
      role: "admin" | "member" | "guest";
      capabilities?: Set<string>;
      bots?: "all" | Set<string>;
      guest?: GuestPermissions;
    };
  }
}

export function createRequireAuth(
  sessions: SessionStore,
  clientTokens: ClientTokenStore,
  permissions: PermissionStore,
  getGuestConfig: () => GuestModeConfig
): RequestHandler {
  return function requireAuth(req: Request, res: Response, next: NextFunction) {
    // Bearer path (non-browser clients): an explicit header credential fails
    // loudly — no fallback to any ambient cookie, no cookie side effects.
    const authHeader = req.headers.authorization;
    let result: SessionValidation | null;
    let viaBearer = false;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      viaBearer = true;
      result = clientTokens.validate(authHeader.slice(7));
      if (!result) {
        res.status(401).json({ error: "invalid token" });
        return;
      }
    } else {
      result = validateSessionFromHeaders(req.headers.cookie, sessions);
      if (!result) {
        res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
        res.status(401).json({ error: "登录状态已过期，请重新登录" });
        return;
      }
    }
    // A guest session is only valid while guest mode is enabled. Disabling it
    // immediately invalidates any in-flight guest sessions. (Bearer tokens are
    // never guest-issued, but the shared path makes that a no-op.)
    const guestCfg = getGuestConfig();
    if (result.role === "guest" && !guestCfg.enabled) {
      if (!viaBearer) {
        res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      }
      res.status(401).json({ error: "登录状态已过期，请重新登录" });
      return;
    }
    const ctx = resolvePermissionContext(
      result.role,
      result.userId,
      permissions,
      result.role === "guest" ? { bots: guestCfg.bots, permissions: guestCfg.permissions } : undefined
    );
    req.user = {
      id: result.userId,
      username: result.username,
      role: result.role,
      capabilities: ctx.capabilities,
      bots: ctx.bots,
      guest: ctx.guest,
    };
    // Sliding renewal is cookie-session bookkeeping only.
    if (!viaBearer) {
      const token = extractSessionToken(req.headers.cookie);
      if (token) {
        res.cookie(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: req.secure,
          path: "/",
          maxAge: SESSION_TTL_MS,
        });
      }
    }
    next();
  };
}
