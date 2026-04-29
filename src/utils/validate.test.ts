import { describe, it, expect } from "vitest";
import { validatePlatform, validateBotId, validateStringParam } from "./validate.js";

describe("validatePlatform", () => {
  it("accepts valid platforms", () => {
    expect(validatePlatform("netease")).toBe("netease");
    expect(validatePlatform("qq")).toBe("qq");
    expect(validatePlatform("bilibili")).toBe("bilibili");
    expect(validatePlatform("youtube")).toBe("youtube");
  });

  it("returns default for undefined", () => {
    expect(validatePlatform(undefined)).toBe("netease");
  });

  it("throws for invalid platform", () => {
    expect(() => validatePlatform("spotify")).toThrow(/Invalid platform/);
  });
});

describe("validateBotId", () => {
  it("accepts non-empty string", () => {
    expect(validateBotId("bot-123")).toBe("bot-123");
  });

  it("throws for empty string", () => {
    expect(() => validateBotId("")).toThrow(/botId is required/);
  });

  it("throws for too-long string", () => {
    expect(() => validateBotId("x".repeat(200))).toThrow(/too long/);
  });
});

describe("validateStringParam", () => {
  it("accepts valid string", () => {
    expect(validateStringParam("test", "param", 100)).toBe("test");
  });

  it("trims whitespace", () => {
    expect(validateStringParam("  hello  ", "param", 100)).toBe("hello");
  });

  it("throws for empty after trim", () => {
    expect(() => validateStringParam("   ", "param", 100)).toThrow(/is required/);
  });

  it("throws for too-long string", () => {
    expect(() => validateStringParam("x".repeat(200), "param", 100)).toThrow(/too long/);
  });
});
