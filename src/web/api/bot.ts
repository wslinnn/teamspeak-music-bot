import { Router, type RequestHandler } from "express";
import type { BotManager } from "../../bot/manager.js";
import type { BotConfig } from "../../data/config.js";
import { saveConfig } from "../../data/config.js";
import type { Logger } from "../../logger.js";
import { validateBotId } from "../../utils/validate.js";

declare module "express-serve-static-core" {
  interface Request {
    validatedId?: string;
  }
}

export function createBotRouter(
  botManager: BotManager,
  config: BotConfig,
  configPath: string,
  logger: Logger,
  requireAuth?: RequestHandler,
  requireAdmin?: RequestHandler
): Router {
  const router = Router();
  const auth = requireAuth ?? ((_req, _res, next) => next());
  const adminOnly = requireAdmin ?? ((_req, _res, next) => next());

  router.get("/", auth, (_req, res) => {
    const bots = botManager.getAllBots().map((b) => b.getStatus());
    res.json({ bots });
  });

  // GET /api/bot/settings — 读取全局 bot 行为设置
  router.get("/settings", auth, (_req, res) => {
    res.json({
      idleTimeoutMinutes: config.idleTimeoutMinutes ?? 0,
      commandPrefix: config.commandPrefix ?? "!",
    });
  });

  // POST /api/bot/settings — 保存全局 bot 行为设置
  router.post("/settings", adminOnly, (req, res) => {
    const { idleTimeoutMinutes, commandPrefix } = req.body;

    if (idleTimeoutMinutes !== undefined) {
      if (typeof idleTimeoutMinutes !== "number" || idleTimeoutMinutes < 0) {
        res.status(400).json({ success: false, error: "idleTimeoutMinutes must be a non-negative number" });
        return;
      }
      config.idleTimeoutMinutes = idleTimeoutMinutes;
      for (const bot of botManager.getAllBots()) {
        bot.updateIdleTimeout(idleTimeoutMinutes);
      }
    }

    if (commandPrefix !== undefined) {
      if (typeof commandPrefix !== "string" || commandPrefix.trim().length === 0) {
        res.status(400).json({ success: false, error: "commandPrefix must be a non-empty string" });
        return;
      }
      config.commandPrefix = commandPrefix.trim();
    }

    saveConfig(configPath, config);
    res.json({ success: true });
  });

  // Middleware: validate :id param for all /:id routes below
  router.use("/:id", (req, res, next) => {
    try {
      req.validatedId = validateBotId(req.params.id);
      next();
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  router.get("/:id", auth, (req, res) => {
    const bot = botManager.getBot(req.validatedId!);
    if (!bot) {
      res.status(404).json({ success: false, error: "Bot not found" });
      return;
    }
    res.json(bot.getStatus());
  });

  // Get saved config for a bot
  router.get("/:id/config", auth, (req, res) => {
    const saved = botManager.getBotConfig(req.validatedId!);
    if (!saved) {
      res.status(404).json({ success: false, error: "Bot config not found" });
      return;
    }
    res.json(saved);
  });

  router.post("/", adminOnly, async (req, res) => {
    try {
      const {
        name,
        serverAddress,
        serverPort,
        nickname,
        defaultChannel,
        channelPassword,
        serverPassword,
        autoStart,
      } = req.body;
      if (!name || !serverAddress || !nickname) {
        res
          .status(400)
          .json({ success: false, error: "name, serverAddress, and nickname are required" });
        return;
      }
      const bot = await botManager.createBot({
        name,
        serverAddress,
        serverPort: serverPort ?? 9987,
        nickname,
        defaultChannel,
        channelPassword,
        serverPassword,
        autoStart: autoStart ?? false,
      });
      res.status(201).json(bot.getStatus());
    } catch (err) {
      logger.error({ err }, "Failed to create bot");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // Update bot config (must be stopped first to apply connection changes)
  router.put("/:id", adminOnly, async (req, res) => {
    try {
      const id = req.validatedId!;
      const bot = botManager.getBot(id);
      if (!bot) {
        res.status(404).json({ success: false, error: "Bot not found" });
        return;
      }
      const { name, serverAddress, serverPort, nickname, defaultChannel, channelPassword, serverPassword } = req.body;
      botManager.updateBot(id, {
        name, serverAddress, serverPort, nickname, defaultChannel, channelPassword, serverPassword,
      });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "Failed to update bot");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.delete("/:id", adminOnly, async (req, res) => {
    try {
      await botManager.removeBot(req.validatedId!);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/:id/start", adminOnly, async (req, res) => {
    try {
      await botManager.startBot(req.validatedId!);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/:id/stop", adminOnly, (req, res) => {
    try {
      botManager.stopBot(req.validatedId!);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
