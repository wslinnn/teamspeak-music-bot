import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";

export function createFavoritesRouter(
  database: BotDatabase,
  broadcast: (data: object) => void
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      const favorites = database.getFavorites();
      res.json({ favorites });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { songId, platform, title, artist, coverUrl } = req.body;
      if (!songId || !platform || !title) {
        res.status(400).json({ error: "songId, platform, and title are required" });
        return;
      }
      database.addFavorite({ songId, platform, title, artist: artist || "", coverUrl: coverUrl || "" });
      const favorites = database.getFavorites();
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const ok = database.deleteFavorite(id);
      if (!ok) {
        res.status(404).json({ error: "Favorite not found" });
        return;
      }
      const favorites = database.getFavorites();
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
