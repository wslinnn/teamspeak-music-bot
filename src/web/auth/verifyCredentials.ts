import bcrypt from "bcryptjs";
import type { Logger } from "../../logger.js";
import type { UserStore, UserRow } from "../../data/users.js";
import type { AuditStore } from "../../data/audit.js";

const FAILED_LOGIN_DELAY_MS = 250;

// Timing equalizer (review S4): a fixed bcrypt hash so the missing-user login
// branch costs the same bcrypt compare as the existing-user branch — without
// it, response latency reveals whether a username exists.
const DUMMY_HASH = bcrypt.hashSync("tsmb-timing-equalizer", 12);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared credential check for password logins (cookie sessions in
 * /api/session/login, bearer tokens in /api/client/login). Returns the user
 * row on success; on failure burns the same time as a real bcrypt compare,
 * records a `login.failed` audit row and returns null — so both login routes
 * stay behaviourally identical.
 */
export async function verifyLoginCredentials(
  users: UserStore,
  audit: AuditStore,
  logger: Logger,
  username: string,
  password: string,
): Promise<UserRow | null> {
  const user = users.findByUsername(username);
  const ok = await users.verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    await delay(FAILED_LOGIN_DELAY_MS);
    // Audit SEC-12: record failed attempts so brute-forcing is visible in
    // the audit trail (actor fields stay null — no verified identity yet).
    try {
      audit.record({
        actorId: null, actorUsername: null,
        targetUserId: null, targetUsername: username,
        action: "login.failed",
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr, action: "login.failed" }, "audit insert failed");
    }
    return null;
  }
  return user;
}
