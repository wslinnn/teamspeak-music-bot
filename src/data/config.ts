import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface BotConfig {
  webPort: number;
  locale: "zh" | "en";
  theme: "dark" | "light";
  commandPrefix: string;
  commandAliases: Record<string, string>;
  neteaseApiPort: number;
  qqMusicApiPort: number;
  adminPassword: string;
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
    adminGroups: [],
    autoReturnDelay: 300,
    autoPauseOnEmpty: true,
    idleTimeoutMinutes: 0,
    publicUrl: "",
    trustProxy: false,
  };
}

/**
 * Validate config values. Throws on invalid values.
 */
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
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}
