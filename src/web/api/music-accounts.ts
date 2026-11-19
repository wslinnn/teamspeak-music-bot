import { Router } from "express";
import {
  MusicAccountCapacityError,
  type BotDatabase,
  type MusicAccount,
  type MusicAccountCapacityReason,
} from "../../data/database.js";
import type { Logger } from "../../logger.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { maskCookie, SCOPED_PLATFORMS } from "./provider-scope.js";

/**
 * Admin management of the shared music-account pool.
 *
 * Gated on `requireAdmin`, deliberately NOT on a `bot.manage` capability: a
 * member must never learn which account is assigned to whom. Cookies are read
 * from the DB but never leave the server — only `cookiePreview` is serialised.
 */

/** Wire shape of an account: identical minus the credential. */
interface AccountWire {
  id: number;
  platform: string;
  label: string;
  cookiePreview: string;
  ownerId: string | null;
  capacity: number;
  enabled: boolean;
  /** How many members currently hold this account. */
  grantCount: number;
  createdAt: string;
  updatedAt: string;
}

function toWire(account: MusicAccount, grantCount: number): AccountWire {
  return {
    id: account.id,
    platform: account.platform,
    label: account.label,
    cookiePreview: maskCookie(account.cookie),
    ownerId: account.ownerId,
    capacity: account.capacity,
    enabled: account.enabled,
    grantCount,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

const CAPACITY_STATUS: Record<MusicAccountCapacityReason, { status: number; message: string }> = {
  account_exclusive: { status: 409, message: "该账号为独占账号，已被分配" },
  account_full: { status: 409, message: "该账号的分配名额已满" },
  capacity_below_existing_grants: { status: 409, message: "容量不能低于当前已分配人数" },
};

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** capacity 0 is meaningful (= unlimited), so it needs its own parser. */
function parseCapacity(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function createMusicAccountsRouter(
  database: BotDatabase,
  logger: Logger,
): Router {
  const router = Router();
  router.use(requireAdmin);

  const grantCounts = (): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const g of database.listMusicAccountGrants()) {
      counts.set(g.accountId, (counts.get(g.accountId) ?? 0) + 1);
    }
    return counts;
  };

  router.get("/", (_req, res) => {
    const counts = grantCounts();
    res.json({
      accounts: database.listMusicAccounts().map((a) => toWire(a, counts.get(a.id) ?? 0)),
      grants: database.listMusicAccountGrants(),
    });
  });

  router.post("/", (req, res) => {
    const { platform, label, cookie, capacity, enabled } = req.body ?? {};
    if (typeof cookie !== "string" || !cookie.trim()) {
      res.status(400).json({ error: "cookie is required" });
      return;
    }
    if (typeof platform !== "string" || !platform) {
      res.status(400).json({ error: "platform is required" });
      return;
    }
    const parsedCapacity = capacity === undefined ? 0 : parseCapacity(capacity);
    if (parsedCapacity === null) {
      res.status(400).json({ error: "capacity must be a non-negative integer" });
      return;
    }

    const account = database.createMusicAccount({
      platform,
      label: typeof label === "string" ? label : "",
      cookie,
      capacity: parsedCapacity,
      enabled: enabled !== false,
    });
    logger.info(
      { accountId: account.id, platform: account.platform, capacity: account.capacity },
      "Music account created",
    );
    res.status(201).json({ account: toWire(account, 0) });
  });

  router.patch("/:id", (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.cookie === "string" && body.cookie.trim()) patch.cookie = body.cookie;
    if (body.capacity !== undefined) {
      const capacity = parseCapacity(body.capacity);
      if (capacity === null) {
        res.status(400).json({ error: "capacity must be a non-negative integer" });
        return;
      }
      patch.capacity = capacity;
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    try {
      const updated = database.updateMusicAccount(id, patch as never);
      if (!updated) {
        res.status(404).json({ error: "account not found" });
        return;
      }
      const counts = grantCounts();
      res.json({ account: toWire(updated, counts.get(updated.id) ?? 0) });
    } catch (err) {
      if (err instanceof MusicAccountCapacityError) {
        const { status, message } = CAPACITY_STATUS[err.reason];
        res.status(status).json({ error: message, code: err.reason });
        return;
      }
      throw err;
    }
  });

  router.delete("/:id", (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    if (!database.deleteMusicAccount(id)) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.put("/:id/grants/:userId", (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const account = database.getMusicAccount(id);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const userId = req.params.userId;
    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      database.assignMusicAccount(userId, account.platform, id, req.user!.id);
      logger.info({ accountId: id, userId, platform: account.platform }, "Music account assigned");
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof MusicAccountCapacityError) {
        const { status, message } = CAPACITY_STATUS[err.reason];
        res.status(status).json({ error: message, code: err.reason });
        return;
      }
      throw err;
    }
  });

  router.delete("/:id/grants/:userId", (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const account = database.getMusicAccount(id);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const userId = req.params.userId;
    const existing = database.getMusicAccountGrant(userId, account.platform);
    if (!existing || existing.accountId !== id) {
      res.status(404).json({ error: "grant not found" });
      return;
    }
    database.revokeMusicAccount(userId, account.platform);
    res.json({ ok: true });
  });

  /** Platforms that support per-account logins — drives the admin form. */
  router.get("/platforms", (_req, res) => {
    res.json({ platforms: [...SCOPED_PLATFORMS] });
  });

  return router;
}
