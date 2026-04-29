import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";

export function createFavoritesRouter(
  _database: BotDatabase,
  _broadcast: (data: object) => void
): Router {
  const router = Router();
  // Stub — will be implemented in Task 2
  return router;
}
