import { Router } from "express";
import type { MusicProvider } from "../../music/provider.js";
import { YouTubeProvider } from "../../music/youtube.js";
import type { CookieStore } from "../../music/auth.js";
import type { Logger } from "../../logger.js";
import type { BotConfig } from "../../data/config.js";
import { signToken } from "../../auth/jwt.js";
import { createRateLimiter } from "../../auth/rate-limit.js";

export function createAuthRouter(
  neteaseProvider: MusicProvider,
  qqProvider: MusicProvider,
  bilibiliProvider: MusicProvider,
  logger: Logger,
  cookieStore?: CookieStore
): Router {
  return createAuthRouterWithConfig(
    neteaseProvider, qqProvider, bilibiliProvider, logger, undefined, undefined, undefined, cookieStore
  );
}

export function createAuthRouterWithConfig(
  neteaseProvider: MusicProvider,
  qqProvider: MusicProvider,
  bilibiliProvider: MusicProvider,
  logger: Logger,
  config?: BotConfig,
  jwtSecret?: string,
  jwtExpiresIn?: string,
  cookieStore?: CookieStore
): Router {
  const router = Router();
  // YouTube is auth-less; we only use this instance so /auth/status can
  // report whether yt-dlp is actually installed (loggedIn=false otherwise).
  const youtubeProvider: MusicProvider = new YouTubeProvider();

  function getProvider(platform?: string): MusicProvider {
    if (platform === "bilibili") return bilibiliProvider;
    if (platform === "youtube") return youtubeProvider;
    return platform === "qq" ? qqProvider : neteaseProvider;
  }

  router.get("/status", async (req, res) => {
    try {
      const platform = req.query.platform as string;
      const provider = getProvider(platform);
      const status = await provider.getAuthStatus();
      logger.debug({ platform, status }, "Auth status check");
      res.json({ platform: provider.platform, ...status });
    } catch (err) {
      logger.error({ err }, "Auth status check failed");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/qrcode", async (req, res) => {
    try {
      const { platform } = req.body;
      const provider = getProvider(platform);
      const qr = await provider.getQrCode();
      logger.info({ platform, key: qr.key }, "QR code generated");
      res.json(qr);
    } catch (err) {
      logger.error({ err }, "QR code generation failed");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.get("/qrcode/status", async (req, res) => {
    try {
      const { key, platform } = req.query;
      if (!key) {
        res.status(400).json({ success: false, error: "key is required" });
        return;
      }
      const provider = getProvider(platform as string);
      const status = await provider.checkQrCodeStatus(key as string);
      logger.info({ platform, status, key }, "QR status check");

      // When confirmed, persist cookie
      if (status === "confirmed") {
        const cookie = provider.getCookie();
        const plat = (platform as string) === "bilibili" ? "bilibili" as const
          : (platform as string) === "qq" ? "qq" as const : "netease" as const;
        if (cookie && cookieStore) {
          cookieStore.save(plat, cookie);
          logger.info({ platform: plat }, "Cookie persisted to disk");
        }
      }

      res.json({ status });
    } catch (err) {
      logger.error({ err }, "QR status check failed");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/sms/send", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ success: false, error: "phone is required" });
        return;
      }
      if (!neteaseProvider.sendSmsCode) {
        res
          .status(400)
          .json({ success: false, error: "SMS login not supported for this platform" });
        return;
      }
      const success = await neteaseProvider.sendSmsCode(phone);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/sms/verify", async (req, res) => {
    try {
      const { phone, code } = req.body;
      if (!phone || !code) {
        res.status(400).json({ success: false, error: "phone and code are required" });
        return;
      }
      if (!neteaseProvider.loginWithSms) {
        res.status(400).json({ success: false, error: "SMS login not supported" });
        return;
      }
      const success = await neteaseProvider.loginWithSms(phone, code);
      if (success && cookieStore) {
        cookieStore.save("netease", neteaseProvider.getCookie());
      }
      res.json({ success });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/cookie", (req, res) => {
    const { platform, cookie } = req.body;
    if (!cookie) {
      res.status(400).json({ success: false, error: "cookie is required" });
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
    const provider = getProvider(platform);
    provider.setCookie(cookie);
    const plat = platform === "bilibili" ? "bilibili" as const
      : platform === "qq" ? "qq" as const : "netease" as const;
    if (cookieStore) {
      cookieStore.save(plat, cookie);
    }
    res.json({ success: true });
  });

  // Admin login endpoint
  if (config && jwtSecret && jwtExpiresIn) {
    const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5000 });

    router.post("/login", (req, res, next) => {
      const ip = req.ip ?? "unknown";
      if (loginLimiter.isLimited(ip)) {
        res.status(429).json({ success: false, error: "Too many login attempts" });
        return;
      }
      next();
    }, (req, res) => {
      const { username, password } = req.body;

      // Legacy single-admin mode (password only)
      if (
        !username &&
        password === config.adminPassword &&
        config.adminPassword
      ) {
        const token = signToken("admin", jwtSecret, jwtExpiresIn, "admin");
        res.json({ success: true, token, expiresIn: jwtExpiresIn });
        return;
      }

      // User array mode
      const user = config.users.find(
        (u) => u.username === username && u.password === password
      );
      if (user) {
        const token = signToken(user.role, jwtSecret, jwtExpiresIn, user.username);
        res.json({ success: true, token, expiresIn: jwtExpiresIn });
        return;
      }

      const clientIp = req.ip ?? "unknown";
      loginLimiter.recordFailure(clientIp);
      logger.warn({ ip: clientIp }, "Login failed");
      res.status(401).json({ success: false, error: "Invalid credentials" });
    });
  }

  return router;
}
