import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { getDefaultConfig, loadConfig, saveConfig, validateConfig } from "./config.js";

describe("config", () => {
  const dirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "tsmusicbot-test-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("returns default config when file does not exist", () => {
    const config = loadConfig("/nonexistent/path/config.json");
    expect(config).toEqual(getDefaultConfig());
  });

  it("creates config file on save", () => {
    const dir = makeTmpDir();
    const path = join(dir, "sub", "config.json");
    const config = getDefaultConfig();
    saveConfig(path, config);

    const loaded = loadConfig(path);
    expect(loaded).toEqual(config);
  });

  it("merges partial config with defaults", () => {
    const dir = makeTmpDir();
    const path = join(dir, "config.json");

    // Save a partial config by writing only some fields
    const partial = { webPort: 8080, locale: "en" };
    writeFileSync(path, JSON.stringify(partial), "utf-8");

    const loaded = loadConfig(path);
    expect(loaded.webPort).toBe(8080);
    expect(loaded.locale).toBe("en");
    // defaults should fill in the rest
    expect(loaded.theme).toBe("dark");
    expect(loaded.commandPrefix).toBe("!");
    expect(loaded.autoPauseOnEmpty).toBe(true);
  });
});

describe("validateConfig", () => {
  it("accepts valid config", () => {
    const config = getDefaultConfig();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects port below 1", () => {
    const config = { ...getDefaultConfig(), webPort: 0 };
    expect(() => validateConfig(config)).toThrow(/webPort/);
  });

  it("rejects port above 65535", () => {
    const config = { ...getDefaultConfig(), webPort: 70000 };
    expect(() => validateConfig(config)).toThrow(/webPort/);
  });

  it("rejects negative autoReturnDelay", () => {
    const config = { ...getDefaultConfig(), autoReturnDelay: -1 };
    expect(() => validateConfig(config)).toThrow(/autoReturnDelay/);
  });

  it("rejects invalid locale", () => {
    const config = { ...getDefaultConfig(), locale: "fr" as "zh" | "en" };
    expect(() => validateConfig(config)).toThrow(/locale/);
  });

  it("rejects invalid theme", () => {
    const config = { ...getDefaultConfig(), theme: "neon" as "dark" | "light" };
    expect(() => validateConfig(config)).toThrow(/theme/);
  });
});
