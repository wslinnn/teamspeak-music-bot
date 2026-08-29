/**
 * Marker for errors whose message is safe — and useful — to echo back to the
 * WebUI or TS chat: business rejections like "音源未启用：xxx" or
 * "Bot is not connected to TeamSpeak".
 *
 * Audit SEC-07: the web layer must NOT echo arbitrary `err.message` — fs
 * errors carry absolute paths, axios errors carry upstream hostnames, parser
 * errors carry stack traces. Any other error reaching a route's catch block
 * is answered with a fixed 500 body (see web/api/respond.ts) while the real
 * cause goes to the server log.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
