import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCookieStore } from "./auth.js";

describe("createCookieStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cookiestore-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a clean cookie", () => {
    const store = createCookieStore(dir);
    store.save("netease", "MUSIC_U=abc; __csrf=xyz");
    expect(store.load("netease")).toBe("MUSIC_U=abc; __csrf=xyz");
  });

  it("normalises a polluted cookie on save", () => {
    const store = createCookieStore(dir);
    store.save("netease", "MUSIC_U=abc; Max-Age=100; Path=/; Expires=Mon, 06 Dec 2094 04:18:36 GMT");
    expect(store.load("netease")).toBe("MUSIC_U=abc");

    const raw = JSON.parse(fs.readFileSync(path.join(dir, "netease.json"), "utf-8"));
    expect(raw.cookie).toBe("MUSIC_U=abc");
  });

  it("repairs an already-stored polluted blob on load and writes it back", () => {
    const file = path.join(dir, "netease.json");
    fs.writeFileSync(file, JSON.stringify({ cookie: "MUSIC_U=abc; Max-Age=1; Path=/", updatedAt: "x" }));

    const store = createCookieStore(dir);
    expect(store.load("netease")).toBe("MUSIC_U=abc");

    // repair in place — the next boot never has to redo it
    const after = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(after.cookie).toBe("MUSIC_U=abc");
  });

  it("does not rewrite the file when the cookie is already clean", () => {
    const store = createCookieStore(dir);
    store.save("netease", "MUSIC_U=abc");
    const file = path.join(dir, "netease.json");
    const before = fs.statSync(file).mtimeMs;

    store.load("netease");
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it("never normalises the jellyfin JSON credential blob", () => {
    const store = createCookieStore(dir);
    const blob = JSON.stringify({ accessToken: "tok=1", userId: "u", deviceId: "d" });
    store.save("jellyfin", blob);
    expect(store.load("jellyfin")).toBe(blob);
  });

  it("returns '' when the stored value is not a string", () => {
    fs.writeFileSync(path.join(dir, "qq.json"), JSON.stringify({ cookie: { not: "a string" } }));
    const store = createCookieStore(dir);
    expect(store.load("qq")).toBe("");
  });

  it("returns '' for a missing file", () => {
    const store = createCookieStore(dir);
    expect(store.load("kugou")).toBe("");
  });

  it("returns '' for a corrupt file", () => {
    fs.writeFileSync(path.join(dir, "bilibili.json"), "{ not json");
    const store = createCookieStore(dir);
    expect(store.load("bilibili")).toBe("");
  });
});
