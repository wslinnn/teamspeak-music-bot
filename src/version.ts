import { readFileSync } from "node:fs";

/**
 * The running application's version, read from the shipped package manifest.
 *
 * Used for the OpenProtocol announce payload (a plugin shows it to the user).
 * Deliberately NOT exposed on the unauthenticated /api/health endpoint — the
 * security audit (SEC-11) removed version disclosure there.
 */
function loadAppVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version === "string" && manifest.version.trim()) {
      return manifest.version.trim();
    }
  } catch {
    // A custom bundle may omit the package manifest.
  }
  return "unknown";
}

export const APP_VERSION = loadAppVersion();
