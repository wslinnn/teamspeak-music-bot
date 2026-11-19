import fs from "node:fs";
import path from "node:path";
import { normalizeCookie } from "./cookie-normalize.js";

/** Platforms with a persisted credential blob. For jellyfin the "cookie" is a
 *  JSON string carrying the access token / userId / deviceId (see jellyfin.ts). */
type CookiePlatform = "netease" | "qq" | "bilibili" | "kugou" | "jellyfin";

export interface CookieStore {
  save(platform: CookiePlatform, cookie: string): void;
  load(platform: CookiePlatform): string;
}

/** Jellyfin's "cookie" is a JSON credential blob, not a Cookie header — running
 *  normalizeCookie over it would mangle the payload. */
function storesCookieHeader(platform: CookiePlatform): boolean {
  return platform !== "jellyfin";
}

function cleanCookie(platform: CookiePlatform, cookie: string): string {
  return storesCookieHeader(platform) ? normalizeCookie(cookie) : cookie;
}

export function createCookieStore(cookieDir: string): CookieStore {
  if (!fs.existsSync(cookieDir)) {
    fs.mkdirSync(cookieDir, { recursive: true });
  }

  return {
    save(platform: CookiePlatform, cookie: string): void {
      const filePath = path.join(cookieDir, `${platform}.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({ cookie: cleanCookie(platform, cookie), updatedAt: new Date().toISOString() }),
        { encoding: "utf-8", mode: 0o600 }
      );
    },

    load(platform: CookiePlatform): string {
      const filePath = path.join(cookieDir, `${platform}.json`);
      if (!fs.existsSync(filePath)) return "";
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        // Only a string is a credential; a number/object here means a corrupt
        // or hand-edited file and must not leak into a request.
        const stored = typeof data?.cookie === "string" ? data.cookie : "";
        const clean = cleanCookie(platform, stored);
        // Repair in place: deployments that already stored a raw Set-Cookie
        // header keep working without asking anyone to log in again. A
        // read-only volume must not break loading, so a write failure is
        // swallowed.
        if (clean !== stored) {
          try {
            fs.writeFileSync(
              filePath,
              JSON.stringify({ cookie: clean, updatedAt: new Date().toISOString() }),
              { encoding: "utf-8", mode: 0o600 }
            );
          } catch {
            // read-only volume — the in-memory value is still clean
          }
        }
        return clean;
      } catch {
        return "";
      }
    },
  };
}
