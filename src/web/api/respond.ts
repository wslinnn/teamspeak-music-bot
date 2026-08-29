import type { Request, Response } from "express";
import type { Logger } from "../../logger.js";
import { UserFacingError } from "../../errors.js";

/**
 * Uniform catch-all answerer for route handlers (audit SEC-07).
 *
 * - `UserFacingError`: the message was written for the user ("音源未启用",
 *   "Bot is not connected…") and is echoed verbatim so the WebUI toast keeps
 *   its actionable copy.
 * - anything else: the raw `err.message` previously leaked absolute server
 *   paths (fs errors), upstream hostnames/ports (axios errors) and parser
 *   details to authenticated — sometimes guest — callers. The real cause is
 *   logged server-side with the failing route; the client gets fixed text.
 */
export function respondError(logger: Logger, req: Request, res: Response, err: unknown): void {
  if (err instanceof UserFacingError) {
    res.status(500).json({ error: err.message });
    return;
  }
  logger.error({ err, route: `${req.method} ${req.originalUrl}` }, "request failed");
  res.status(500).json({ error: "服务器内部错误，详情请查看服务端日志" });
}
