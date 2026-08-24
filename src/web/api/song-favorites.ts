import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";

/**
 * Song favorites (fork feature): cross-client song favorites.
 * Mounted at /api/song-favorites — the upstream /api/favorites route is the
 * per-user playlist favorites and must not be shadowed.
 */
export function createSongFavoritesRouter(
  database: BotDatabase,
  broadcast: (data: object) => void
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      const favorites = database.getSongFavorites();
      res.json({ favorites });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { songId, platform, title, artist, coverUrl, duration } = req.body;
      if (!songId || !platform || !title) {
        res.status(400).json({ success: false, error: "songId, platform, and title are required" });
        return;
      }
      database.addSongFavorite({
        songId, platform, title,
        artist: artist || "",
        coverUrl: coverUrl || "",
        duration: duration ?? 0,
      });
      const favorites = database.getSongFavorites();
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ success: false, error: "Invalid id" });
        return;
      }
      const ok = database.deleteSongFavorite(id);
      if (!ok) {
        res.status(404).json({ success: false, error: "Favorite not found" });
        return;
      }
      const favorites = database.getSongFavorites();
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
