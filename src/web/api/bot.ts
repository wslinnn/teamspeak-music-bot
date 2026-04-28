import { Router } from "express";
import type { BotManager } from "../../bot/manager.js";
import type { BotConfig } from "../../data/config.js";
import { saveConfig } from "../../data/config.js";
import type { Logger } from "../../logger.js";
import { validateBotId } from "../../utils/validate.js";

export function createBotRouter(
  botManager: BotManager,
  config: BotConfig,
  configPath: string,
  logger: Logger
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const bots = botManager.getAllBots().map((b) => b.getStatus());
    res.json({ bots });
  });

  router.get("/:id", (req, res) => {
    let id: string;
    try {
      id = validateBotId(req.params.id);
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    const bot = botManager.getBot(id);
    if (!bot) {
      res.status(404).json({ success: false, error: "Bot not found" });
      return;
    }
    res.json(bot.getStatus());
  });

  // Get saved config for a bot
  router.get("/:id/config", (req, res) => {
    let id: string;
    try {
      id = validateBotId(req.params.id);
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    const saved = botManager.getBotConfig(id);
    if (!saved) {
      res.status(404).json({ success: false, error: "Bot config not found" });
      return;
    }
    res.json(saved);
  });

  router.post("/", async (req, res) => {
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
  router.put("/:id", async (req, res) => {
    try {
      let id: string;
      try {
        id = validateBotId(req.params.id);
      } catch (err) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      const bot = botManager.getBot(id);
      if (!bot) {
        res.status(404).json({ success: false, error: "Bot not found" });
        return;
      }
      const { name, serverAddress, serverPort, nickname, defaultChannel, channelPassword, serverPassword } = req.body;
      // Update in database
      botManager.updateBot(id, {
        name, serverAddress, serverPort, nickname, defaultChannel, channelPassword, serverPassword,
      });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "Failed to update bot");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      let id: string;
      try {
        id = validateBotId(req.params.id);
      } catch (err) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      await botManager.removeBot(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/:id/start", async (req, res) => {
    try {
      let id: string;
      try {
        id = validateBotId(req.params.id);
      } catch (err) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      await botManager.startBot(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/:id/stop", (req, res) => {
    try {
      let id: string;
      try {
        id = validateBotId(req.params.id);
      } catch (err) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      botManager.stopBot(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });
  
  // GET /api/bot/settings — 读取全局 bot 行为设置
  router.get("/settings", (_req, res) => {
    res.json({ idleTimeoutMinutes: config.idleTimeoutMinutes ?? 0 });
  });

  // POST /api/bot/settings — 保存全局 bot 行为设置
  router.post("/settings", (req, res) => {
    const { idleTimeoutMinutes } = req.body;
    if (typeof idleTimeoutMinutes !== "number" || idleTimeoutMinutes < 0) {
      res.status(400).json({ success: false, error: "idleTimeoutMinutes must be a non-negative number" });
      return;
    }
    config.idleTimeoutMinutes = idleTimeoutMinutes;
    saveConfig(configPath, config);
    // 通知所有 bot 实例更新定时器
    for (const bot of botManager.getAllBots()) {
      bot.updateIdleTimeout(idleTimeoutMinutes);
    }
    res.json({ ok: true });
  });

  return router;
}
