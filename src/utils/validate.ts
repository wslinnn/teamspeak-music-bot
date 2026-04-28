export type Platform = "netease" | "qq" | "bilibili" | "youtube";

const VALID_PLATFORMS: Set<string> = new Set(["netease", "qq", "bilibili", "youtube"]);

/**
 * Validate and return a music platform string.
 * Returns "netease" (default) if undefined.
 * Throws on invalid values.
 */
export function validatePlatform(platform: string | undefined): Platform {
  if (!platform) return "netease";
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(`Invalid platform: '${platform}'. Must be one of: netease, qq, bilibili, youtube`);
  }
  return platform as Platform;
}

/**
 * Validate a bot ID parameter. Must be a non-empty string up to 128 chars.
 */
export function validateBotId(id: string): string {
  if (!id || id.trim().length === 0) {
    throw new Error("botId is required");
  }
  const trimmed = id.trim();
  if (trimmed.length > 128) {
    throw new Error(`botId is too long (max 128 chars, got ${trimmed.length})`);
  }
  return trimmed;
}

/**
 * Validate a generic string parameter.
 * Trims whitespace, rejects empty/too-long values.
 */
export function validateStringParam(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} is too long (max ${maxLength} chars, got ${trimmed.length})`);
  }
  return trimmed;
}
