import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

describe("Rate limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests when no failures recorded", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
  });

  it("does not limit when failures are within threshold", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
  });

  it("blocks when failures exceed the limit", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isLimited("1.2.3.4")).toBe(true);
  });

  it("resets after the window expires", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isLimited("1.2.3.4")).toBe(true);
    vi.advanceTimersByTime(5001);
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
  });

  it("tracks IPs independently", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.recordFailure("1.1.1.1");
    limiter.recordFailure("1.1.1.1");
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
    expect(limiter.isLimited("2.2.2.2")).toBe(false);
  });

  it("isLimited does not increment the counter", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.recordFailure("1.2.3.4");
    // Calling isLimited multiple times should not affect the count
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
  });
});
