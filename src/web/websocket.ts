import { WebSocketServer, WebSocket } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { BotInstance } from "../bot/instance.js";
import type { Logger } from "../logger.js";

export interface WebSocketController {
  cleanup: () => void;
  /**
   * Fork addition: broadcast an arbitrary payload to all connected clients.
   * Used by fork routes (e.g. song favorites live sync).
   */
  broadcast: (data: object, botId?: string) => void;
  /**
   * Re-apply the current guest-mode policy to every already-open guest socket.
   * If guest mode is disabled, in-flight guest sockets are force-closed; otherwise
   * each guest socket is live re-scoped so out-of-scope bots stop streaming.
   */
  refreshGuestPolicy: (cfg: { enabled: boolean; bots: "all" | string[] }) => void;
  /**
   * Audit SEC-08: close a user's open sockets when their sessions are revoked
   * (logout / password change / admin reset). Previously sockets survived
   * revocation and kept streaming. `exceptTokenHash` spares the socket that
   * belongs to the still-valid session (e.g. the actor changing their own
   * password). 4001 = auth-failure close code (B3 contract).
   */
  closeUserSessions: (userId: string, opts?: { exceptTokenHash?: string }) => void;
  /**
   * Close exactly the sockets authenticated with one client bearer token
   * (DELETE /api/client/session). Counterpart to closeUserSessions: there the
   * hash marks the one session to SPARE, here it IS the match. Same 4001
   * auth-failure close code (B3 contract).
   */
  closeSocketsByTokenHash: (tokenHash: string) => void;
}

export function setupWebSocket(
  wss: WebSocketServer,
  botManager: BotManager,
  logger: Logger
): WebSocketController {
  const clients = new Set<WebSocket>();

  /**
   * Whether a given bot is visible to a WebSocket client. server.ts stamps
   * `botScope` at upgrade from the same permission context the HTTP
   * middlewares use, so BOTH scoped guests and members restricted via
   * user_bot_access only see their allowed bots; admins/unrestricted
   * clients get "all".
   */
  function visibleToClient(ws: WebSocket, botId: string): boolean {
    const w = ws as unknown as { botScope?: "all" | Set<string> };
    if (!w.botScope || w.botScope === "all") return true;
    return w.botScope.has(botId);
  }

  /** Track which bot instances have listeners attached (keyed by id, storing ref) */
  const attachedBots = new Map<string, {
    bot: BotInstance;
    stateChange: () => void;
    connected: () => void;
    disconnected: () => void;
  }>();

  /**
   * Audit PERF-03: stateChange fires ~30× per song (transport, volume,
   * occupancy…), and re-sending the whole queue each time serializes a
   * 1000-song array into every socket. Track a per-bot queue signature and
   * omit `queue` from the payload while it is unchanged — clients keep
   * their local copy (queueUnchanged flag, contract honoured by
   * web/src/composables/useWebSocket.ts). Exact id comparison: a missed
   * update here would silently stale the UI, so no lossy hashing.
   */
  const lastQueueSig = new Map<string, string>();

  function queueSignature(bot: BotInstance): string {
    const songs = bot.getQueue();
    return `${songs.length}:${songs.map((s) => s.id).join(",")}`;
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.debug("WebSocket client connected");

    const bots = botManager
      .getAllBots()
      .filter((b) => visibleToClient(ws, b.id))
      .map((b) => b.getStatus());
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

  const broadcast = (data: object, botId?: string) => {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (botId !== undefined && !visibleToClient(client, botId)) continue;
      try {
        client.send(message);
      } catch {
        clients.delete(client);
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
    lastQueueSig.delete(id);
  }

  function attachBotListener(bot: BotInstance): void {
    const existing = attachedBots.get(bot.id);
    if (existing) {
      if (existing.bot === bot) return; // already attached to this instance
      // Bot instance was replaced (e.g. startBot re-created it) — re-attach
      detachBotListener(bot.id);
    }

    const onStateChange = () => {
      const sig = queueSignature(bot);
      const queueUnchanged = lastQueueSig.get(bot.id) === sig;
      lastQueueSig.set(bot.id, sig);
      broadcast(
        queueUnchanged
          ? { type: "stateChange", botId: bot.id, status: bot.getStatus(), queueUnchanged: true }
          : { type: "stateChange", botId: bot.id, status: bot.getStatus(), queue: bot.getQueue() },
        bot.id,
      );
    };

    const onConnected = () => {
      broadcast({
        type: "botConnected",
        botId: bot.id,
        status: bot.getStatus(),
      }, bot.id);
    };

    const onDisconnected = () => {
      broadcast({
        type: "botDisconnected",
        botId: bot.id,
        status: bot.getStatus(),
      }, bot.id);
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
    broadcast({ type: "botRemoved", botId: id }, id);
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

  const cleanup = () => {
    clearInterval(intervalId);
    botManager.removeListener("botInstance", onBotInstance);
    botManager.removeListener("botInstanceRemoved", onBotInstanceRemoved);
    // Clean up all attached listeners (detach from stored bot refs, not live map)
    for (const id of Array.from(attachedBots.keys())) {
      detachBotListener(id);
    }
  };

  // When the admin changes guestMode (disable / narrow scope), already-open guest
  // sockets must stop streaming immediately — their isGuest/botScope were stamped
  // once at upgrade and would otherwise keep receiving bot state.
  const refreshGuestPolicy = (cfg: { enabled: boolean; bots: "all" | string[] }) => {
    for (const ws of clients) {
      const w = ws as unknown as { isGuest?: boolean; botScope?: "all" | Set<string> };
      if (!w.isGuest) continue;
      if (!cfg.enabled) {
        // 4001 = 认证失效（与 upgrade 阶段的关闭码一致，B3）：前端据此提示
        // 重新登录而不是盲目重连
        try {
          ws.close(4001, "guest mode disabled");
        } catch {
          // socket may already be closing; ignore
        }
      } else {
        w.botScope = cfg.bots === "all" ? "all" : new Set(cfg.bots);
      }
    }
  };

  const closeUserSessions = (userId: string, opts?: { exceptTokenHash?: string }): void => {
    for (const ws of clients) {
      const w = ws as unknown as { userId?: string; tokenHash?: string };
      if (w.userId !== userId) continue;
      if (opts?.exceptTokenHash && w.tokenHash === opts.exceptTokenHash) continue;
      try {
        ws.close(4001, "session revoked");
      } catch {
        // socket may already be closing; ignore
      }
    }
  };

  const closeSocketsByTokenHash = (tokenHash: string): void => {
    for (const ws of clients) {
      const w = ws as unknown as { tokenHash?: string };
      if (w.tokenHash !== tokenHash) continue;
      try {
        ws.close(4001, "session revoked");
      } catch {
        // socket may already be closing; ignore
      }
    }
  };

  return { cleanup, refreshGuestPolicy, broadcast, closeUserSessions, closeSocketsByTokenHash };
}
