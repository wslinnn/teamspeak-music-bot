import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

describe("Rate limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests within the limit", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    expect(limiter.check("1.2.3.4")).toBe(true);
    expect(limiter.check("1.2.3.4")).toBe(true);
    expect(limiter.check("1.2.3.4")).toBe(true);
  });

  it("blocks requests exceeding the limit", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4")).toBe(false);
  });

  it("resets after the window expires", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4")).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(limiter.check("1.2.3.4")).toBe(true);
  });

  it("tracks IPs independently", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.check("1.1.1.1");
    limiter.check("1.1.1.1");
    expect(limiter.check("2.2.2.2")).toBe(true);
  });
});
