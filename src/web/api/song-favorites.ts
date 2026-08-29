import { Router } from "express";
import type { Logger } from "../../logger.js";
import { respondError } from "./respond.js";
import type { BotDatabase } from "../../data/database.js";
import { sanitizeJellyfinCoverUrl } from "../../music/jellyfin.js";

/** Egress mapper: legacy rows may carry Jellyfin covers with an embedded
 *  api_key (pre-proxy writes) — rewrite them to the token-free proxy path. */
function sanitizeList<T extends { coverUrl?: string }>(favorites: T[]): T[] {
  return favorites.map((f) => ({ ...f, coverUrl: sanitizeJellyfinCoverUrl(f.coverUrl ?? "") }));
}

/**
 * Song favorites (fork feature): PER-USER song favorites, isolated by the
 * WebUI session user. Mounted at /api/song-favorites — the upstream
 * /api/favorites route is the per-user playlist favorites and must not be
 * shadowed. The WS notification carries no payload: every client refetches
 * its own list (a broadcast with data would leak other users' favorites).
 */
export function createSongFavoritesRouter(
  database: BotDatabase,
  broadcast: (data: object) => void,
  logger: Logger
): Router {
  const router = Router();

  router.get("/", (req, res) => {
    try {
      const favorites = sanitizeList(database.getSongFavorites(req.user!.id));
      res.json({ favorites });
    } catch (err) {
      respondError(logger, req, res, err);
    }
  });

  router.post("/", (req, res) => {
    try {
      const userId = req.user!.id;
      const { songId, platform, title, artist, coverUrl, duration } = req.body;
      if (!songId || !platform || !title) {
        res.status(400).json({ success: false, error: "songId, platform, and title are required" });
        return;
      }
      try {
        database.addSongFavorite({
          userId,
          songId,
          platform,
          title,
          artist: artist || "",
          coverUrl: coverUrl || "",
          duration: duration ?? 0,
        });
      } catch (insErr) {
        const e = insErr as { code?: string };
        if (e?.code === "SQLITE_CONSTRAINT_UNIQUE") {
          // 红心状态过期（WS 事件丢失等）：已收藏过，幂等成功即可
          res.json({ success: true, favorites: sanitizeList(database.getSongFavorites(userId)) });
          return;
        }
        throw insErr;
      }
      broadcast({ type: "favoritesChanged" });
      res.json({ success: true, favorites: sanitizeList(database.getSongFavorites(userId)) });
    } catch (err) {
      respondError(logger, req, res, err);
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: "Invalid id" });
        return;
      }
      const ok = database.deleteSongFavorite(id, req.user!.id);
      if (!ok) {
        res.status(404).json({ success: false, error: "Favorite not found" });
        return;
      }
      broadcast({ type: "favoritesChanged" });
      res.json({ success: true, favorites: sanitizeList(database.getSongFavorites(req.user!.id)) });
    } catch (err) {
      respondError(logger, req, res, err);
    }
  });

  return router;
}
