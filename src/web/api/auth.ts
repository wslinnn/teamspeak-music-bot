import { Router } from "express";
import { respondError } from "./respond.js";
import type { MusicProvider } from "../../music/provider.js";
import { YouTubeProvider } from "../../music/youtube.js";
import type { CookieStore } from "../../music/auth.js";
import type { Logger } from "../../logger.js";
import type { BotConfig, JellyfinConfig } from "../../data/config.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireNotGuest } from "../middleware/requireNotGuest.js";

export function createAuthRouter(
  neteaseProvider: MusicProvider,
  qqProvider: MusicProvider,
  bilibiliProvider: MusicProvider,
  logger: Logger,
  cookieStore?: CookieStore,
  kugouProvider?: MusicProvider,
  spotifyProvider?: MusicProvider,
  jellyfinProvider?: MusicProvider,
  config?: BotConfig
): Router {
  const router = Router();
  // YouTube is auth-less; we only use this instance so /auth/status can
  // report whether yt-dlp is actually installed (loggedIn=false otherwise).
  const youtubeProvider: MusicProvider = new YouTubeProvider();

  function getProvider(platform?: string): MusicProvider {
    if (platform === "bilibili") return bilibiliProvider;
    if (platform === "youtube") return youtubeProvider;
    if (platform === "kugou" && kugouProvider) return kugouProvider;
    if (platform === "spotify" && spotifyProvider) return spotifyProvider;
    if (platform === "jellyfin" && jellyfinProvider) return jellyfinProvider;
    return platform === "qq" ? qqProvider : neteaseProvider;
  }

  router.get("/status", requireNotGuest, async (req, res) => {
    try {
      const platform = req.query.platform as string;
      const provider = getProvider(platform);
      const status = await provider.getAuthStatus();
      logger.debug({ platform, status }, "Auth status check");
      res.json({ platform: provider.platform, ...status });
    } catch (err) {
      logger.error({ err }, "Auth status check failed");
      respondError(logger, req, res, err);
    }
  });

  router.post("/qrcode", requirePermission("platform.auth"), async (req, res) => {
    try {
      const { platform } = req.body;
      const provider = getProvider(platform);
      const qr = await provider.getQrCode();
      logger.info({ platform }, "QR code generated"); // key omitted (audit SEC-11)
      res.json(qr);
    } catch (err) {
      logger.error({ err }, "QR code generation failed");
      respondError(logger, req, res, err);
    }
  });

  // QR 轮询服务端 TTL：一个 key 首次被查询后超过 QR_POLL_TTL_MS 就直接回
  // expired，不再转发上游——前端 Bug 2（离开页面/二维码未扫成）会让 2s 一次的
  // 轮询打满上游整个有效期。Map 容量有界（超限清扫过期项）。
  const QR_POLL_TTL_MS = 5 * 60_000;
  const qrPollFirstSeen = new Map<string, number>();
  function trackQrKeyTtl(key: string): boolean {
    const now = Date.now();
    const first = qrPollFirstSeen.get(key);
    if (first === undefined) {
      if (qrPollFirstSeen.size >= 500) {
        for (const [k, t] of qrPollFirstSeen) {
          if (now - t > QR_POLL_TTL_MS) qrPollFirstSeen.delete(k);
        }
      }
      qrPollFirstSeen.set(key, now);
      return true;
    }
    return now - first < QR_POLL_TTL_MS;
  }

  router.get("/qrcode/status", requireNotGuest, async (req, res) => {
    try {
      const { key, platform } = req.query;
      if (!key) {
        res.status(400).json({ error: "key is required" });
        return;
      }
      // TTL 已过：不再转发上游，直接判过期（前端会据此停止轮询）。
      if (!trackQrKeyTtl(key as string)) {
        logger.debug({ platform }, "QR status check short-circuited (TTL expired)");
        res.json({ status: "expired" });
        return;
      }
      const provider = getProvider(platform as string);
      const status = await provider.checkQrCodeStatus(key as string);
      logger.debug({ platform, status }, "QR status check"); // key omitted (audit SEC-11)

      // When confirmed, persist cookie
      if (status === "confirmed") {
        const cookie = provider.getCookie();
        const plat = (platform as string) === "bilibili" ? "bilibili" as const
          : (platform as string) === "kugou" ? "kugou" as const
          : (platform as string) === "qq" ? "qq" as const : "netease" as const;
        if (cookie && cookieStore) {
          cookieStore.save(plat, cookie);
          logger.info({ platform: plat }, "Cookie persisted to disk");
        }
      }

      res.json({ status });
    } catch (err) {
      logger.error({ err }, "QR status check failed");
      respondError(logger, req, res, err);
    }
  });

  // Jellyfin has no QR/cookie flow — the connection is admin-configured. This
  // round-trips /System/Info so Settings can verify form values BEFORE saving.
  // Empty/missing credential fields fall back to the stored config, so a
  // masked (not re-entered) password still tests the live setup.
  router.post("/jellyfin/test", requirePermission("platform.auth"), async (req, res) => {
    const testable = jellyfinProvider as
      | (MusicProvider & {
          testConnection?: (
            candidate?: JellyfinConfig,
          ) => Promise<{ ok: boolean; serverName?: string; version?: string; error?: string }>;
        })
      | undefined;
    if (!testable?.testConnection) {
      res.status(501).json({ error: "Jellyfin provider not available" });
      return;
    }
    try {
      const body = (req.body ?? {}) as Partial<JellyfinConfig>;
      const stored = config?.jellyfin;
      const str = (v: unknown, fallback: string) =>
        typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
      const candidate: JellyfinConfig = {
        serverUrl: str(body.serverUrl, stored?.serverUrl ?? ""),
        authMode:
          body.authMode === "apikey" || body.authMode === "userpass"
            ? body.authMode
            : stored?.authMode ?? "userpass",
        username: str(body.username, stored?.username ?? ""),
        password: str(body.password, stored?.password ?? ""),
        apiKey: str(body.apiKey, stored?.apiKey ?? ""),
        userId: str(body.userId, stored?.userId ?? ""),
      };
      res.json(await testable.testConnection(candidate));
    } catch (err) {
      logger.error({ err }, "Jellyfin test connection failed");
      respondError(logger, req, res, err);
    }
  });

  router.post("/sms/send", requirePermission("platform.auth"), async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ error: "phone is required" });
        return;
      }
      if (!neteaseProvider.sendSmsCode) {
        res
          .status(400)
          .json({ error: "SMS login not supported for this platform" });
        return;
      }
      const success = await neteaseProvider.sendSmsCode(phone);
      res.json({ success });
    } catch (err) {
      respondError(logger, req, res, err);
    }
  });

  router.post("/sms/verify", requirePermission("platform.auth"), async (req, res) => {
    try {
      const { phone, code } = req.body;
      if (!phone || !code) {
        res.status(400).json({ error: "phone and code are required" });
        return;
      }
      if (!neteaseProvider.loginWithSms) {
        res.status(400).json({ error: "SMS login not supported" });
        return;
      }
      const success = await neteaseProvider.loginWithSms(phone, code);
      if (success && cookieStore) {
        cookieStore.save("netease", neteaseProvider.getCookie());
      }
      res.json({ success });
    } catch (err) {
      respondError(logger, req, res, err);
    }
  });

  router.post("/cookie", requirePermission("platform.auth"), (req, res) => {
    const { platform, cookie } = req.body;
    if (!cookie) {
      res.status(400).json({ error: "cookie is required" });
      return;
    }
    // YouTube has no cookie concept — reject instead of falling through and
    // clobbering the NetEase cookie entry.
    if (platform === "youtube") {
      res
        .status(400)
        .json({ error: "YouTube does not use cookies (uses yt-dlp binary)" });
      return;
    }
    // Jellyfin auth is server-configured (Settings → connection card), not
    // cookie-based; falling through would clobber the NetEase cookie entry.
    if (platform === "jellyfin") {
      res
        .status(400)
        .json({ error: "Jellyfin 通过 Settings 配置连接，不支持手动 Cookie" });
      return;
    }
    const provider = getProvider(platform);
    provider.setCookie(cookie);
    const plat = platform === "bilibili" ? "bilibili" as const
      : platform === "kugou" ? "kugou" as const
      : platform === "qq" ? "qq" as const : "netease" as const;
    if (cookieStore) {
      cookieStore.save(plat, cookie);
    }
    res.json({ success: true });
  });

  return router;
}
