import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { hashToken, type SessionValidation } from "./sessions.js";

/** Bearer tokens for non-browser clients (tsmb-desktop). Much longer-lived
 *  than cookie sessions — a companion app shouldn't re-login weekly — with
 *  revocation still available via password change / DELETE /api/client/session. */
export const CLIENT_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
/** Audit-trail touch throttle (mirrors SESSION_TOUCH_INTERVAL_MS). Unlike
 *  sessions this does NOT extend expiry: fixed 60-day lifetime, re-login to
 *  renew — long-lived credentials should not slide indefinitely. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const MAX_CLIENT_TOKENS_PER_USER = 10;

export interface IssuedClientToken {
  token: string;
  expiresAt: number;
}

export interface ClientTokenStore {
  createToken(userId: string, deviceName?: string): IssuedClientToken;
  /** Fixed-expiry validation (no sliding renewal); throttled lastUsedAt touch. */
  validate(rawToken: string): SessionValidation | null;
  deleteToken(rawToken: string): void;
  deleteAllForUser(userId: string): void;
  cleanupExpired(): void;
}

/** Same storage discipline as sessions: PK is sha256(token); the plaintext
 *  only ever appears in the issuance response. */
export function createClientTokenStore(db: Database.Database): ClientTokenStore {
  const insertStmt = db.prepare(
    "INSERT INTO client_tokens (id, userId, deviceName, createdAt, lastUsedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const selectStmt = db.prepare(`
    SELECT t.id, t.userId, t.deviceName, t.expiresAt, t.lastUsedAt, u.username, u.role
    FROM client_tokens t INNER JOIN users u ON u.id = t.userId
    WHERE t.id = ?
  `);
  const touchStmt = db.prepare("UPDATE client_tokens SET lastUsedAt = ? WHERE id = ?");
  const deleteByIdStmt = db.prepare("DELETE FROM client_tokens WHERE id = ?");
  const deleteAllForUserStmt = db.prepare("DELETE FROM client_tokens WHERE userId = ?");
  const cleanupStmt = db.prepare("DELETE FROM client_tokens WHERE expiresAt < ?");
  const countForUserStmt = db.prepare("SELECT COUNT(*) AS n FROM client_tokens WHERE userId = ?");
  const deleteOldestForUserStmt = db.prepare(
    "DELETE FROM client_tokens WHERE id IN (SELECT id FROM client_tokens WHERE userId = ? ORDER BY createdAt ASC LIMIT ?)"
  );

  return {
    createToken(userId, deviceName) {
      const token = randomBytes(32).toString("base64url");
      const id = hashToken(token);
      const now = Date.now();
      // Same eviction pattern as createSessionStore: cap devices per user,
      // oldest first, in a transaction so concurrent logins can't overshoot.
      const tx = db.transaction(() => {
        const existing = (countForUserStmt.get(userId) as { n: number }).n;
        if (existing >= MAX_CLIENT_TOKENS_PER_USER) {
          deleteOldestForUserStmt.run(userId, existing - MAX_CLIENT_TOKENS_PER_USER + 1);
        }
        insertStmt.run(id, userId, deviceName ?? "desktop", now, now, now + CLIENT_TOKEN_TTL_MS);
      });
      tx();
      return { token, expiresAt: now + CLIENT_TOKEN_TTL_MS };
    },

    validate(rawToken) {
      if (!rawToken) return null;
      const id = hashToken(rawToken);
      const row = selectStmt.get(id) as
        | { id: string; userId: string; expiresAt: number; lastUsedAt: number | null; username: string; role: string }
        | undefined;
      if (!row) return null;
      const now = Date.now();
      if (row.expiresAt < now) {
        deleteByIdStmt.run(id);
        return null;
      }
      if (row.lastUsedAt === null || now - row.lastUsedAt > TOUCH_INTERVAL_MS) {
        touchStmt.run(now, id);
      }
      return { userId: row.userId, username: row.username, role: row.role as "admin" | "member" | "guest" };
    },

    deleteToken(rawToken) {
      deleteByIdStmt.run(hashToken(rawToken));
    },

    deleteAllForUser(userId) {
      deleteAllForUserStmt.run(userId);
    },

    cleanupExpired() {
      cleanupStmt.run(Date.now());
    },
  };
}
