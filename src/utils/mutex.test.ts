import { describe, it, expect } from "vitest";
import { Mutex } from "./mutex.js";

describe("Mutex", () => {
  it("runs a single function", async () => {
    const mutex = new Mutex();
    const result = await mutex.run(() => 42);
    expect(result).toBe(42);
  });

  it("serializes concurrent calls", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const p1 = mutex.run(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
    });
    const p2 = mutex.run(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("releases lock even if function throws", async () => {
    const mutex = new Mutex();
    await expect(mutex.run(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    const result = await mutex.run(() => "ok");
    expect(result).toBe("ok");
  });

  it("returns the function's return value", async () => {
    const mutex = new Mutex();
    const result = await mutex.run(async () => "hello");
    expect(result).toBe("hello");
  });
});
