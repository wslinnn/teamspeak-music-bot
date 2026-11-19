import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDatabase,
  MusicAccountCapacityError,
  type BotDatabase,
} from "./database.js";

let db: BotDatabase;
let dir: string;

function addUser(id: string): void {
  db.db.prepare(
    `INSERT INTO users (id, username, passwordHash, createdAt, updatedAt, role)
     VALUES (?, ?, 'x', ?, ?, 'member')`,
  ).run(id, id, Date.now(), Date.now());
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "acctpool-"));
  db = createDatabase(path.join(dir, "test.db"));
  addUser("u1");
  addUser("u2");
  addUser("u3");
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("music account pool — CRUD", () => {
  it("creates and reads back an account", () => {
    const a = db.createMusicAccount({ platform: "netease", label: "VIP", cookie: "MUSIC_U=x" });
    expect(a.id).toBeGreaterThan(0);
    expect(a.platform).toBe("netease");
    expect(a.cookie).toBe("MUSIC_U=x");
    expect(a.enabled).toBe(true);
    expect(a.ownerId).toBeNull();
    expect(db.getMusicAccount(a.id)).toMatchObject({ label: "VIP" });
  });

  it("lists accounts across platforms", () => {
    db.createMusicAccount({ platform: "netease", cookie: "a" });
    db.createMusicAccount({ platform: "qq", cookie: "b" });
    expect(db.listMusicAccounts()).toHaveLength(2);
  });

  it("patches only the provided fields", () => {
    const a = db.createMusicAccount({ platform: "netease", label: "old", cookie: "c1" });
    const updated = db.updateMusicAccount(a.id, { label: "new" });
    expect(updated).toMatchObject({ label: "new", cookie: "c1" });
  });

  it("returns null when patching a missing row", () => {
    expect(db.updateMusicAccount(9999, { label: "x" })).toBeNull();
  });

  it("deletes an account and its grants", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    expect(db.deleteMusicAccount(a.id)).toBe(true);
    expect(db.selectGrantedAccount("u1", "netease")).toBeNull();
  });
});

describe("music account pool — capacity", () => {
  it("capacity 0 means unlimited", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", capacity: 0 });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.assignMusicAccount("u2", "netease", a.id, "admin");
    db.assignMusicAccount("u3", "netease", a.id, "admin");
    expect(db.listMusicAccountGrants()).toHaveLength(3);
  });

  it("capacity 1 is exclusive: the second grant is refused", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", capacity: 1 });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    expect(() => db.assignMusicAccount("u2", "netease", a.id, "admin")).toThrow(
      MusicAccountCapacityError,
    );
    try {
      db.assignMusicAccount("u2", "netease", a.id, "admin");
    } catch (e) {
      expect((e as MusicAccountCapacityError).reason).toBe("account_exclusive");
    }
  });

  it("reattributing the same user to the same account is not a new grant", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", capacity: 1 });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    // Must not throw: this is an update, not a second grant.
    expect(() => db.assignMusicAccount("u1", "netease", a.id, "admin")).not.toThrow();
  });

  it("capacity N caps the number of grants", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", capacity: 2 });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.assignMusicAccount("u2", "netease", a.id, "admin");
    try {
      db.assignMusicAccount("u3", "netease", a.id, "admin");
      throw new Error("expected a capacity error");
    } catch (e) {
      expect((e as MusicAccountCapacityError).reason).toBe("account_full");
    }
  });

  it("refuses to shrink capacity below the grants already handed out", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", capacity: 0 });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.assignMusicAccount("u2", "netease", a.id, "admin");
    expect(() => db.updateMusicAccount(a.id, { capacity: 1 })).toThrow(
      MusicAccountCapacityError,
    );
  });

  it("allows shrinking to exactly the current grant count", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", capacity: 0 });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.assignMusicAccount("u2", "netease", a.id, "admin");
    expect(db.updateMusicAccount(a.id, { capacity: 2 })).toMatchObject({ capacity: 2 });
  });

  it("refuses to grant a disabled account", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c", enabled: false });
    expect(() => db.assignMusicAccount("u1", "netease", a.id, "admin")).toThrow(
      MusicAccountCapacityError,
    );
  });
});

describe("music account pool — grants", () => {
  it("disabling an account revokes it immediately and reversibly", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    expect(db.selectGrantedAccount("u1", "netease")).not.toBeNull();

    db.updateMusicAccount(a.id, { enabled: false });
    expect(db.selectGrantedAccount("u1", "netease")).toBeNull();
    // the grant row survives, so re-enabling restores it
    expect(db.getMusicAccountGrant("u1", "netease")).not.toBeNull();

    db.updateMusicAccount(a.id, { enabled: true });
    expect(db.selectGrantedAccount("u1", "netease")).not.toBeNull();
  });

  it("revokes a grant", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    expect(db.revokeMusicAccount("u1", "netease")).toBe(true);
    expect(db.selectGrantedAccount("u1", "netease")).toBeNull();
  });

  it("keeps one grant per (user, platform) — reassigning overwrites", () => {
    const a1 = db.createMusicAccount({ platform: "netease", cookie: "c1" });
    const a2 = db.createMusicAccount({ platform: "netease", cookie: "c2" });
    db.assignMusicAccount("u1", "netease", a1.id, "admin");
    db.assignMusicAccount("u1", "netease", a2.id, "admin");
    expect(db.listMusicAccountGrants()).toHaveLength(1);
    expect(db.selectGrantedAccount("u1", "netease")?.id).toBe(a2.id);
  });
});

describe("music account pool — shared-login preference", () => {
  it("defaults to false", () => {
    expect(db.getMusicPref("u1", "netease")).toBe(false);
  });

  it("persists and flips back without touching the account", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "c" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");

    db.setMusicPref("u1", "netease", true);
    expect(db.getMusicPref("u1", "netease")).toBe(true);

    db.setMusicPref("u1", "netease", false);
    expect(db.getMusicPref("u1", "netease")).toBe(false);
    // the underlying grant is untouched by the preference flag
    expect(db.selectGrantedAccount("u1", "netease")?.id).toBe(a.id);
  });
});

describe("music account pool — own cookie stays separate from grants", () => {
  it("a member's own cookie and an admin grant are independent rows", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "admin-cookie" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.setUserMusicCookie("u1", "netease", "own-cookie");

    // linking your own account must not clobber the admin's assignment
    expect(db.getUserMusicCookie("u1", "netease")).toBe("own-cookie");
    expect(db.selectGrantedAccount("u1", "netease")?.cookie).toBe("admin-cookie");

    // unlinking your own must not revoke the admin's grant either
    db.deleteUserMusicCookie("u1", "netease");
    expect(db.selectGrantedAccount("u1", "netease")?.cookie).toBe("admin-cookie");
  });
});
