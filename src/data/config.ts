import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

function acquireFileLock(lockPath: string): void {
  const maxRetries = 100;
  const retryDelayMs = 10;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      return;
    } catch {
      // Check for stale lock (> 5s)
      try {
        const stat = statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 5000) {
          unlinkSync(lockPath);
        }
      } catch {
        // ignore
      }
      if (i < maxRetries - 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
      }
    }
  }
  throw new Error(`Could not acquire file lock: ${lockPath}`);
}

function releaseFileLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

export interface BotConfig {
  webPort: number;
  locale: "zh" | "en";
  theme: "dark" | "light";
  commandPrefix: string;
  commandAliases: Record<string, string>;
  neteaseApiPort: number;
  qqMusicApiPort: number;
  adminPassword: string;
  userPassword: string;
  adminGroups: number[];
  autoReturnDelay: number;
  autoPauseOnEmpty: boolean;
  idleTimeoutMinutes: number;
  // Public base URL used when generating share links (e.g. the bot专属链接).
  // Leave empty to use the browser's current origin. Example:
  //   "https://music.example.com" or "http://1.2.3.4:3000"
  publicUrl: string;
  // When true, Express trusts X-Forwarded-* headers from a reverse proxy
  // (nginx/Caddy/Cloudflare). Required for correct protocol/host detection
  // behind HTTPS-terminating proxies.
  trustProxy: boolean;
  /** JWT token expiration time (e.g. "24h", "7d"). Default: "7d" */
  jwtExpiresIn: string;
}

export function getDefaultConfig(): BotConfig {
  return {
    webPort: 3000,
    locale: "zh",
    theme: "dark",
    commandPrefix: "!",
    commandAliases: { p: "play", s: "skip", n: "next" },
    neteaseApiPort: 3001,
    qqMusicApiPort: 3200,
    adminPassword: "",
    userPassword: "",
    adminGroups: [],
    autoReturnDelay: 300,
    autoPauseOnEmpty: true,
    idleTimeoutMinutes: 0,
    publicUrl: "",
    trustProxy: false,
    jwtExpiresIn: "7d",
  };
}

export function validateConfig(config: BotConfig): void {
  const errors: string[] = [];

  if (!Number.isInteger(config.webPort) || config.webPort < 1 || config.webPort > 65535) {
    errors.push(`webPort must be 1-65535, got ${config.webPort}`);
  }
  if (!Number.isInteger(config.neteaseApiPort) || config.neteaseApiPort < 1 || config.neteaseApiPort > 65535) {
    errors.push(`neteaseApiPort must be 1-65535, got ${config.neteaseApiPort}`);
  }
  if (!Number.isInteger(config.qqMusicApiPort) || config.qqMusicApiPort < 1 || config.qqMusicApiPort > 65535) {
    errors.push(`qqMusicApiPort must be 1-65535, got ${config.qqMusicApiPort}`);
  }
  if (config.autoReturnDelay < 0) {
    errors.push(`autoReturnDelay must be >= 0, got ${config.autoReturnDelay}`);
  }
  if (config.idleTimeoutMinutes < 0) {
    errors.push(`idleTimeoutMinutes must be >= 0, got ${config.idleTimeoutMinutes}`);
  }
  if (config.locale !== "zh" && config.locale !== "en") {
    errors.push(`locale must be 'zh' or 'en', got '${config.locale}'`);
  }
  if (config.theme !== "dark" && config.theme !== "light") {
    errors.push(`theme must be 'dark' or 'light', got '${config.theme}'`);
  }

  // Non-empty string validations
  if (!config.commandPrefix || typeof config.commandPrefix !== "string" || config.commandPrefix.trim().length === 0) {
    errors.push(`commandPrefix must be a non-empty string`);
  }
  if (!config.jwtExpiresIn || typeof config.jwtExpiresIn !== "string" || config.jwtExpiresIn.trim().length === 0) {
    errors.push(`jwtExpiresIn must be a non-empty string`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  ${errors.join("\n  ")}`);
  }
}

export function loadConfig(path: string): BotConfig {
  const defaults = getDefaultConfig();
  try {
    const raw = readFileSync(path, "utf-8");
    const partial = JSON.parse(raw) as Partial<BotConfig>;
    const config = { ...defaults, ...partial };
    validateConfig(config);
    return config;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid configuration")) {
      throw err;
    }
    return defaults;
  }
}

export function saveConfig(path: string, config: BotConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  acquireFileLock(lockPath);
  try {
    const tmpPath = join(dirname(path), `.tmp-${Date.now()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
    renameSync(tmpPath, path);
  } finally {
    releaseFileLock(lockPath);
  }
}

