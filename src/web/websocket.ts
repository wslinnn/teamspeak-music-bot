import { WebSocketServer, WebSocket } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { BotInstance } from "../bot/instance.js";
import type { Logger } from "../logger.js";
import { verifyToken } from "../auth/jwt.js";

export function setupWebSocket(
  wss: WebSocketServer,
  botManager: BotManager,
  logger: Logger,
  jwtSecret: string,
  authEnabled: boolean,
): { cleanup: () => void; broadcast: (data: object) => void } {
  const clients = new Set<WebSocket>();

  /** Track which bot instances have listeners attached (keyed by id, storing ref) */
  const attachedBots = new Map<string, {
    bot: BotInstance;
    stateChange: () => void;
    connected: () => void;
    disconnected: () => void;
  }>();

  wss.on("connection", (ws, req) => {
    // --- Token validation ---
    if (authEnabled && jwtSecret) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (!token) {
        logger.warn("WebSocket connection rejected: no token");
        ws.close(4001, "Authentication required");
        return;
      }
      const payload = verifyToken(token, jwtSecret);
      if (!payload) {
        logger.warn("WebSocket connection rejected: invalid token");
        ws.close(4001, "Invalid or expired token");
        return;
      }
    }

    clients.add(ws);
    logger.debug("WebSocket client connected");

    const bots = botManager.getAllBots().map((b) => b.getStatus());
    ws.send(JSON.stringify({ type: "init", bots }));

    ws.on("close", () => {
      clients.delete(ws);
      logger.debug("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      clients.delete(ws);
    });
  });

  const broadcast = (data: object) => {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch {
          clients.delete(client);
        }
      }
    }
  };

  function detachBotListener(id: string): void {
    const existing = attachedBots.get(id);
    if (!existing) return;
    existing.bot.removeListener("stateChange", existing.stateChange);
    existing.bot.removeListener("connected", existing.connected);
    existing.bot.removeListener("disconnected", existing.disconnected);
    attachedBots.delete(id);
  }

  function attachBotListener(bot: BotInstance): void {
    const existing = attachedBots.get(bot.id);
    if (existing) {
      if (existing.bot === bot) return; // already attached to this instance
      // Bot instance was replaced (e.g. startBot re-created it) — re-attach
      detachBotListener(bot.id);
    }

    const onStateChange = () => {
      broadcast({
        type: "stateChange",
        botId: bot.id,
        status: bot.getStatus(),
        queue: bot.getQueue(),
      });
    };

    const onConnected = () => {
      broadcast({
        type: "botConnected",
        botId: bot.id,
        status: bot.getStatus(),
      });
    };

    const onDisconnected = () => {
      broadcast({
        type: "botDisconnected",
        botId: bot.id,
        status: bot.getStatus(),
      });
    };

    bot.on("stateChange", onStateChange);
    bot.on("connected", onConnected);
    bot.on("disconnected", onDisconnected);

    attachedBots.set(bot.id, {
      bot,
      stateChange: onStateChange,
      connected: onConnected,
      disconnected: onDisconnected,
    });
  }

  /** Attach listeners for any new bots that don't have them yet */
  function ensureAllBotsAttached(): void {
    for (const bot of botManager.getAllBots()) {
      attachBotListener(bot);
    }
  }

  // React immediately when a bot instance is created or replaced
  const onBotInstance = (bot: BotInstance) => attachBotListener(bot);
  botManager.on("botInstance", onBotInstance);

  // React when a bot is removed: detach its listener and tell clients to drop it
  const onBotInstanceRemoved = (id: string) => {
    detachBotListener(id);
    broadcast({ type: "botRemoved", botId: id });
  };
  botManager.on("botInstanceRemoved", onBotInstanceRemoved);

  /** Drop attached listeners whose bot is no longer in the manager. */
  function reconcileAttachedBots(): void {
    const liveIds = new Set(botManager.getAllBots().map((b) => b.id));
    for (const id of Array.from(attachedBots.keys())) {
      if (!liveIds.has(id)) detachBotListener(id);
    }
  }

  // Safety net: periodically re-check in case any bot was missed
  const intervalId = setInterval(() => {
    reconcileAttachedBots();
    ensureAllBotsAttached();
  }, 5000);
  ensureAllBotsAttached();

  return {
    cleanup: () => {
      clearInterval(intervalId);
      botManager.removeListener("botInstance", onBotInstance);
      botManager.removeListener("botInstanceRemoved", onBotInstanceRemoved);
      // Clean up all attached listeners (detach from stored bot refs, not live map)
      for (const id of Array.from(attachedBots.keys())) {
        detachBotListener(id);
      }
    },
    broadcast,
  };
}
