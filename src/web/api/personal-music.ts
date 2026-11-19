import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";
import type { MusicProvider, QrCodeResult } from "../../music/provider.js";
import type { Logger } from "../../logger.js";
import { SCOPED_PLATFORMS } from "./provider-scope.js";

/**
 * A provider that can log a web user into their OWN account without touching
 * the bot's shared login, and hand out a view bound to that account (#164).
 */
export interface PersonalLoginProvider {
  getQrCode(): Promise<QrCodeResult>;
  pollQrLogin(key: string): Promise<{ status: "waiting" | "scanned" | "confirmed" | "expired"; cookie?: string }>;
  withCookie(cookie: string): MusicProvider;
}

export function supportsPersonalLogin(
  provider: MusicProvider | undefined,
): provider is MusicProvider & PersonalLoginProvider {
  const p = provider as Partial<PersonalLoginProvider> | undefined;
  return typeof p?.pollQrLogin === "function" && typeof p.withCookie === "function";
}

/**
 * The caller's own music account, linked without touching the bot's shared
 * login (#164).
 *
 * Routes are per-platform (`/netease/...`, `/qq/...`, …) because each source
 * logs in differently: NetEase and Bilibili scan a QR from their own app, QQ
 * and Kugou return a token through the sidecar. `pollQrLogin` is the shared
 * shape — it returns the cookie WITHOUT writing it to the shared provider.
 *
 * Every route acts on req.user only; the cookie is stored server-side and
 * never sent back to the browser.
 */
export function createPersonalMusicRouter(
  database: BotDatabase,
  providers: Partial<Record<string, MusicProvider>>,
  logger: Logger,
): Router {
  const router = Router();

  /** The provider for a path platform, or null when it cannot self-login. */
  function providerFor(platform: string): (MusicProvider & PersonalLoginProvider) | null {
    const candidate = providers[platform];
    if (!candidate || !supportsPersonalLogin(candidate)) return null;
    return candidate as MusicProvider & PersonalLoginProvider;
  }

  /** Resolve the platform from the route prefix, or 501. */
  function requireProvider(platform: string, res: import("express").Response) {
    const provider = providerFor(platform);
    if (!provider) {
      res.status(501).json({ error: `Personal login not supported for ${platform}` });
      return null;
    }
    return provider;
  }

  router.get("/:platform/status", async (req, res) => {
    const platform = req.params.platform;
    const provider = requireProvider(platform, res);
    if (!provider) return;

    const cookie = database.getUserMusicCookie(req.user!.id, platform);
    if (!cookie) {
      res.json({ linked: false, loggedIn: false });
      return;
    }
    try {
      const status = await provider.withCookie(cookie).getAuthStatus();
      res.json({ linked: true, ...status });
    } catch (err) {
      logger.warn({ err, platform }, "Personal music status check failed");
      res.json({ linked: true, loggedIn: false });
    }
  });

  router.post("/:platform/qrcode", async (req, res) => {
    const platform = req.params.platform;
    const provider = requireProvider(platform, res);
    if (!provider) return;
    try {
      res.json(await provider.getQrCode());
    } catch (err) {
      logger.error({ err, platform }, "Personal music QR generation failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/:platform/qrcode/status", async (req, res) => {
    const platform = req.params.platform;
    const provider = requireProvider(platform, res);
    if (!provider) return;

    const key = req.query.key;
    if (typeof key !== "string" || !key) {
      res.status(400).json({ error: "key is required" });
      return;
    }
    try {
      const { status, cookie } = await provider.pollQrLogin(key);
      if (status === "confirmed" && cookie) {
        database.setUserMusicCookie(req.user!.id, platform, cookie);
        logger.info({ userId: req.user!.id, platform }, "Personal music account linked");
      }
      res.json({ status });
    } catch (err) {
      logger.error({ err, platform }, "Personal music QR status check failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete("/:platform", (req, res) => {
    const platform = req.params.platform;
    const provider = requireProvider(platform, res);
    if (!provider) return;

    database.deleteUserMusicCookie(req.user!.id, platform);
    logger.info({ userId: req.user!.id, platform }, "Personal music account unlinked");
    res.json({ ok: true });
  });

  return router;
}

/**
 * Member-facing view of THEIR OWN account scope (per-user music accounts).
 *
 * Every route acts on req.user only: a member never sees another member's link
 * or an admin's assignment of accounts to others. The one exception is the
 * label of an account assigned TO THEM, which they need in order to understand
 * where their recommendations come from — that is their own grant, not someone
 * else's.
 */
export function createMyMusicAccountsRouter(
  database: BotDatabase,
  getPerUserEnabled: () => boolean,
  logger: Logger,
): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    const userId = req.user!.id;
    const enabled = getPerUserEnabled();
    const platforms = SCOPED_PLATFORMS.map((platform) => {
      const own = database.getUserMusicCookie(userId, platform);
      const grant = database.getMusicAccountGrant(userId, platform);
      const account = grant ? database.getMusicAccount(grant.accountId) : null;
      const preferShared = database.getMusicPref(userId, platform);

      // Which credential actually drives metadata reads right now.
      let active: "shared" | "own" | "granted" = "shared";
      if (enabled && !preferShared) {
        if (own) active = "own";
        else if (account?.enabled) active = "granted";
      }

      return {
        platform,
        enabled,
        linked: Boolean(own),
        preferShared,
        active,
        granted: account
          ? {
              label: account.label,
              enabled: account.enabled,
              // A member cannot unlink an admin's assignment.
              canUnlink: false,
            }
          : null,
      };
    });
    res.json({ perUserMusicAccounts: enabled, platforms });
  });

  router.put("/:platform/preference", (req, res) => {
    const platform = req.params.platform;
    if (!(SCOPED_PLATFORMS as readonly string[]).includes(platform)) {
      res.status(404).json({ error: "unsupported platform" });
      return;
    }
    if (!getPerUserEnabled()) {
      res.status(409).json({ error: "per-user music accounts are disabled", code: "per_user_accounts_disabled" });
      return;
    }
    if (typeof req.body?.preferShared !== "boolean") {
      res.status(400).json({ error: "preferShared must be a boolean" });
      return;
    }
    database.setMusicPref(req.user!.id, platform, req.body.preferShared);
    logger.info(
      { userId: req.user!.id, platform, preferShared: req.body.preferShared },
      "Music account preference changed",
    );
    res.json({ ok: true, preferShared: req.body.preferShared });
  });

  return router;
}
