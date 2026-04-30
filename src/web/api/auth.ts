import { Router } from "express";
import type { MusicProvider } from "../../music/provider.js";
import { YouTubeProvider } from "../../music/youtube.js";
import type { CookieStore } from "../../music/auth.js";
import type { Logger } from "../../logger.js";
import type { BotConfig } from "../../data/config.js";
import { signToken, verifyToken } from "../../auth/jwt.js";
import { createRateLimiter } from "../../auth/rate-limit.js";

export const COOKIE_NAME = "tsbot_token";

/** Parse a duration string like "7d" into seconds */
function parseDurationToSeconds(d: string): number {
  const match = d.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600;
  const val = parseInt(match[1], 10);
  const unit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return val * (unit[match[2]] ?? 86400);
}

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
  getJwtSecret?: () => string,
  jwtExpiresIn?: string,
  cookieStore?: CookieStore,
  adminOnly?: (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => void,
): Router {
  const router = Router();
  const requireAdmin = adminOnly ?? ((_req, _res, next) => next());
  // YouTube is auth-less; we only use this instance so /auth/status can
  // report whether yt-dlp is actually installed (loggedIn=false otherwise).
  const youtubeProvider: MusicProvider = new YouTubeProvider();

  function getProvider(platform?: string): MusicProvider {
    if (platform === "bilibili") return bilibiliProvider;
    if (platform === "youtube") return youtubeProvider;
    return platform === "qq" ? qqProvider : neteaseProvider;
  }

  router.get("/status", requireAdmin, async (req, res) => {
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

  router.post("/qrcode", requireAdmin, async (req, res) => {
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

  router.get("/qrcode/status", requireAdmin, async (req, res) => {
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

  router.post("/sms/send", requireAdmin, async (req, res) => {
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

  router.post("/sms/verify", requireAdmin, async (req, res) => {
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

  router.post("/cookie", requireAdmin, (req, res) => {
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
  if (config && getJwtSecret && jwtExpiresIn) {
    const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5000 });
    const cookieMaxAge = parseDurationToSeconds(jwtExpiresIn);
    const secure = !!config.trustProxy;

    router.post("/login", (req, res, next) => {
      const ip = req.ip ?? "unknown";
      if (loginLimiter.isLimited(ip)) {
        res.status(429).json({ success: false, error: "Too many login attempts" });
        return;
      }
      next();
    }, (req, res) => {
      const { password } = req.body;

      let role: "admin" | "user" | null = null;
      if (password && password === config.adminPassword) {
        role = "admin";
      } else if (password && password === config.userPassword) {
        role = "user";
      }

      if (role) {
        const token = signToken(role, getJwtSecret(), jwtExpiresIn);
        res.cookie(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: "strict",
          path: "/",
          secure,
          maxAge: cookieMaxAge * 1000,
        });
        res.json({ success: true, role, expiresIn: jwtExpiresIn });
        return;
      }

      const clientIp = req.ip ?? "unknown";
      loginLimiter.recordFailure(clientIp);
      logger.warn({ ip: clientIp }, "Login failed");
      res.status(401).json({ success: false, error: "Invalid credentials" });
    });

    router.get("/me", (req, res) => {
      let token: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
      if (!token) {
        const cookieHeader = req.headers.cookie;
        if (cookieHeader) {
          for (const part of cookieHeader.split(";")) {
            const [key, ...rest] = part.split("=");
            if (key?.trim() === COOKIE_NAME) {
              token = rest.join("=").trim();
              break;
            }
          }
        }
      }
      if (!token) {
        res.json({ role: null });
        return;
      }
      const payload = verifyToken(token, getJwtSecret());
      if (!payload) {
        res.json({ role: null });
        return;
      }
      res.json({ role: payload.role });
    });

    router.post("/logout", (_req, res) => {
      res.clearCookie(COOKIE_NAME, { path: "/" });
      res.json({ success: true });
    });
  }

  return router;
}
