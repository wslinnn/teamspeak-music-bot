import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";
import { SHARED_QUEUE_OWNER } from "../../data/database.js";
import type { BotManager } from "../../bot/manager.js";
import type { Logger } from "../../logger.js";
import { canAccessBot } from "../middleware/requirePermission.js";

/**
 * The /api/saved-queues router (Feature 1, #119). Named save/load of queues,
 * per-user with a reserved shared bucket. Every route is inert (403) unless
 * savedQueuesEnabled is on, so the feature is fully gated behind the admin flag.
 *
 * Ownership model:
 *  - WebUI save with `shared:true` → SHARED_QUEUE_OWNER (with `createdBy`
 *    recording the actual creator); otherwise the caller's own user id.
 *  - list returns the caller's own queues + shared ones (with creator names).
 *  - load is allowed for the caller's own queues and shared ones; another
 *    user's private queue 404s (no existence leak).
 *  - delete is stricter than load: own queues always; a SHARED queue only by
 *    its creator or an admin — anyone can load a shared queue, but nobody
 *    else can destroy it.
 */
export function createSavedQueuesRouter(
  database: BotDatabase,
  botManager: BotManager,
  isEnabled: () => boolean,
  logger: Logger,
): Router {
  const router = Router();

  /** 共享清单的删除权：创建人本人或 admin（私有清单本就只能本人删） */
  const canDeleteQueue = (
    sq: { ownerId: string; createdBy: string },
    userId: string,
    isAdmin: boolean,
  ): boolean =>
    sq.ownerId === userId ||
    (sq.ownerId === SHARED_QUEUE_OWNER && (isAdmin || sq.createdBy === userId));

  // Feature gate — inert (403) when savedQueuesEnabled is false.
  router.use((_req, res, next) => {
    if (!isEnabled()) {
      res.status(403).json({ error: "此功能未启用" });
      return;
    }
    next();
  });

  // GET / — the caller's own + shared saved queues (meta only, no songs blob).
  router.get("/", (req, res) => {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === "admin";
    const queues = database
      .listSavedQueues(userId, true)
      .map((q) => ({ ...q, canDelete: canDeleteQueue(q, userId, isAdmin) }));
    res.json({ queues });
  });

  // POST / — snapshot a bot's CURRENT queue and upsert it.
  // body: { botId, name, shared? }
  router.post("/", (req, res) => {
    const userId = req.user!.id;
    const { botId, name, shared } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || typeof botId !== "string" || !botId) {
      res.status(400).json({ error: "botId and name are required" });
      return;
    }
    // botId comes from the body (not a URL param), so requireBotAccess
    // middleware can't apply — enforce the same bot access scope inline,
    // BEFORE the existence check to avoid leaking which bot IDs are real.
    if (!canAccessBot(req.user, botId)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const bot = botManager.getBot(botId);
    if (!bot) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    const songs = bot.getQueueManager().list();
    if (songs.length === 0) {
      res.status(400).json({ error: "队列为空，无法保存" });
      return;
    }
    const ownerId = shared === true ? SHARED_QUEUE_OWNER : userId;
    try {
      const saved = database.saveQueue(ownerId, name.trim(), songs, userId);
      logger.info({ userId, ownerId, name: saved.name, count: saved.songCount }, "saved queue upserted");
      res.json({
        queue: {
          id: saved.id,
          ownerId: saved.ownerId,
          name: saved.name,
          songCount: saved.songCount,
        },
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /:id/load — load a saved queue into a bot. body: { botId, mode }
  router.post("/:id/load", async (req, res) => {
    const userId = req.user!.id;
    const username = req.user!.username;
    const id = parseInt(req.params.id, 10);
    const { botId, mode } = req.body ?? {};
    if (Number.isNaN(id) || typeof botId !== "string" || !botId) {
      res.status(400).json({ error: "invalid id/botId" });
      return;
    }
    // Same inline bot-scope check as POST / (body-based botId).
    if (!canAccessBot(req.user, botId)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const sq = database.getSavedQueue(id);
    if (!sq || (sq.ownerId !== userId && sq.ownerId !== SHARED_QUEUE_OWNER)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const bot = botManager.getBot(botId);
    if (!bot) {
      res.status(404).json({ error: "bot not found" });
      return;
    }
    const loadMode = mode === "append" ? "append" : "replace";
    // Under the bot's play gate: loadSavedQueue mutates the queue across an
    // await (resolveAndPlay) and must not interleave with a concurrent play.
    await bot.runExclusive(() => bot.loadSavedQueue(sq.songs, loadMode, username || "游客"));
    res.json({ ok: true, loaded: sq.songs.length, mode: loadMode });
  });

  // DELETE /:id — delete a saved queue. Own queues always; a shared queue
  // only by its creator or an admin (see canDeleteQueue).
  router.delete("/:id", (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const sq = database.getSavedQueue(id);
    if (!sq || (sq.ownerId !== userId && sq.ownerId !== SHARED_QUEUE_OWNER)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!canDeleteQueue(sq, userId, req.user!.role === "admin")) {
      res.status(403).json({ error: "只有创建人或管理员可以删除共享清单" });
      return;
    }
    database.deleteSavedQueue(id);
    logger.info({ userId, id }, "saved queue deleted");
    res.json({ ok: true });
  });

  return router;
}
