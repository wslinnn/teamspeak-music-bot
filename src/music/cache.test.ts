import { describe, it, expect, vi, afterEach } from "vitest";
import { TtlLruCache } from "./cache.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TtlLruCache", () => {
  it("stores and retrieves values within TTL", () => {
    const cache = new TtlLruCache(10);
    cache.set("k", { a: 1 }, 60_000);
    expect(cache.get("k")).toEqual({ a: 1 });
  });

  it("expires entries lazily after TTL", () => {
    vi.useFakeTimers();
    const cache = new TtlLruCache(10);
    cache.set("k", "v", 1_000);
    expect(cache.get("k")).toBe("v");
    vi.advanceTimersByTime(1_001);
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts least-recently-used entry when full, counting touch as use", () => {
    const cache = new TtlLruCache(2);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    // 触碰 a：a 变为最近使用，b 成为最久未用
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 60_000);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("overwrites existing key refreshes recency without evicting", () => {
    const cache = new TtlLruCache(2);
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.set("a", 10, 60_000); // 覆盖也算使用：a 重插到最新端，b 变最久未用
    expect(cache.get("a")).toBe(10);
    cache.set("c", 3, 60_000);
    expect(cache.get("a")).toBe(10); // 被覆盖刷新过的 a 不驱逐
    expect(cache.get("b")).toBeUndefined(); // 驱逐的是 b
    expect(cache.get("c")).toBe(3);
  });

  it("rejects entries larger than maxValueLen", () => {
    const cache = new TtlLruCache(10);
    cache.set("big", "x".repeat(300 * 1024), 60_000);
    expect(cache.get("big")).toBeUndefined();
    const small = new TtlLruCache(10, 64);
    small.set("ok", "x".repeat(50), 60_000); // 序列化后 52 字符 < 64
    expect(small.get("ok")).toBe("x".repeat(50));
  });

  it("caches null but distinguishes it from a miss (undefined)", () => {
    const cache = new TtlLruCache(10);
    cache.set("none", null, 60_000);
    expect(cache.get("none")).toBeNull();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("tracks hits and misses", () => {
    const cache = new TtlLruCache(10);
    cache.set("k", "v", 60_000);
    cache.get("k");
    cache.get("k");
    cache.get("other");
    expect(cache.hits).toBe(2);
    expect(cache.misses).toBe(1);
  });
});
