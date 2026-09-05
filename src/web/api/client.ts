import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "../../logger.js";
import type { UserStore } from "../../data/users.js";
import type { ClientTokenStore } from "../../data/client-tokens.js";
import type { AuditStore } from "../../data/audit.js";
import { hashToken } from "../../data/sessions.js";
import { verifyLoginCredentials } from "../auth/verifyCredentials.js";

/**
 * Bearer-token auth for non-browser clients (tsmb-desktop). Mounted BEFORE
 * the global csrfOriginCheck/requireAuth gates: login carries its credentials
 * in the body (no cookie semantics, so CSRF does not apply), and DELETE
 * /session authenticates with its own inline bearer check.
 */
export function createClientTokenRouter(
  users: UserStore,
  clientTokens: ClientTokenStore,
  audit: AuditStore,
  logger: Logger,
  // Same bridge pattern as the session router: lets this route ask the
  // (later-created) WS hub to close sockets authenticated with the revoked
  // token. Wired in server.ts once setupWebSocket has run.
  closeSocketsByTokenHash: (tokenHash: string) => void
): Router {
  const router = Router();

  const requireBearer = (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const result = clientTokens.validate(header.slice(7));
    if (!result) {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    req.user = { id: result.userId, username: result.username, role: result.role };
    next();
  };

  router.post("/login", async (req, res) => {
    const { username, password, deviceName } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    const user = await verifyLoginCredentials(users, audit, logger, username, password);
    if (!user) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    const device = typeof deviceName === "string" && deviceName.trim()
      ? deviceName.trim().slice(0, 64)
      : "desktop";
    const { token, expiresAt } = clientTokens.createToken(user.id, device);
    logger.info({ userId: user.id, username: user.username, device }, "Client token issued");
    res.status(201).json({ token, expiresAt, id: user.id, username: user.username, role: user.role });
  });

  router.delete("/session", requireBearer, (req, res) => {
    const raw = (req.headers.authorization as string).slice(7);
    const revoked = clientTokens.validate(raw);
    clientTokens.deleteToken(raw);
    // Close exactly the WS sockets this token authenticated (other devices'
    // sessions of the same user survive — unlike closeUserSessions).
    if (revoked) closeSocketsByTokenHash(hashToken(raw));
    res.status(204).end();
  });

  return router;
}
