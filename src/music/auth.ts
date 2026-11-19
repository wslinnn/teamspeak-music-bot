import fs from "node:fs";
import path from "node:path";
import { normalizeCookie } from "./cookie-normalize.js";
import type { createQqSessionStore } from "./qq-session.js";

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

/**
 * When a QQ managed session store is supplied, the qq platform routes through
 * it instead of the flat `qq.json` file. That store also holds the renewal
 * material (musickey / refresh keys), which a plain cookie string cannot carry —
 * writing `qq.json` behind its back would make the next renewal scan overwrite
 * the user's manual login.
 */
export function createCookieStore(
  cookieDir: string,
  qqStore?: ReturnType<typeof createQqSessionStore>,
): CookieStore {
  if (!fs.existsSync(cookieDir)) {
    fs.mkdirSync(cookieDir, { recursive: true });
  }

  return {
    save(platform: CookiePlatform, cookie: string): void {
      if (platform === "qq" && qqStore) {
        // The session store normalises on its own (see qq-session.ts).
        qqStore.save({ cookie });
        return;
      }
      const filePath = path.join(cookieDir, `${platform}.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({ cookie: cleanCookie(platform, cookie), updatedAt: new Date().toISOString() }),
        { encoding: "utf-8", mode: 0o600 }
      );
    },

    load(platform: CookiePlatform): string {
      if (platform === "qq" && qqStore) return qqStore.load()?.cookie ?? "";
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
