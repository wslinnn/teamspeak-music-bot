import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";

export function createFavoritesRouter(
  database: BotDatabase,
  broadcast: (data: object) => void
): Router {
  const router = Router();

  function getUserId(req: Express.Request): string {
    return (req as any).auth?.sub ?? "admin";
  }

  router.get("/", (req, res) => {
    try {
      const favorites = database.getFavorites(getUserId(req));
      res.json({ favorites });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { songId, platform, title, artist, coverUrl } = req.body;
      if (!songId || !platform || !title) {
        res.status(400).json({ success: false, error: "songId, platform, and title are required" });
        return;
      }
      database.addFavorite({ songId, platform, title, artist: artist || "", coverUrl: coverUrl || "", userId: getUserId(req) });
      const favorites = database.getFavorites(getUserId(req));
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
      const ok = database.deleteFavorite(id, getUserId(req));
      if (!ok) {
        res.status(404).json({ success: false, error: "Favorite not found" });
        return;
      }
      const favorites = database.getFavorites(getUserId(req));
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
