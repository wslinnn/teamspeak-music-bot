import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, type BotDatabase } from "../../data/database.js";
import { createMusicAccountsRouter } from "./music-accounts.js";

let db: BotDatabase;
let dir: string;

function makeApp(role: "admin" | "member" = "admin") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: "admin1", role };
    next();
  });
  app.use("/api/music-accounts", createMusicAccountsRouter(db, { error() {}, warn() {}, info() {} } as any));
  return app;
}

function addUser(id: string): void {
  db.db.prepare(
    `INSERT INTO users (id, username, passwordHash, createdAt, updatedAt, role)
     VALUES (?, ?, 'x', ?, ?, 'member')`,
  ).run(id, id, Date.now(), Date.now());
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "acctroute-"));
  db = createDatabase(path.join(dir, "test.db"));
  addUser("u1");
  addUser("u2");
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("music-accounts router — access control", () => {
  it("401s an unauthenticated caller", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/music-accounts", createMusicAccountsRouter(db, {} as any));
    expect((await request(app).get("/api/music-accounts")).status).toBe(401);
  });

  it("403s a member — they must never see who was assigned what", async () => {
    expect((await request(makeApp("member")).get("/api/music-accounts")).status).toBe(403);
  });

  it("403s a member creating an account", async () => {
    const res = await request(makeApp("member"))
      .post("/api/music-accounts")
      .send({ platform: "netease", cookie: "c" });
    expect(res.status).toBe(403);
  });
});

describe("music-accounts router — cookie secrecy", () => {
  it("never returns the raw cookie, only a preview", async () => {
    const created = await request(makeApp())
      .post("/api/music-accounts")
      .send({ platform: "netease", label: "VIP", cookie: "MUSIC_U=SUPER-SECRET-VALUE" });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("SUPER-SECRET-VALUE");
    expect(created.body.account.cookiePreview).toContain("…");

    const list = await request(makeApp()).get("/api/music-accounts");
    expect(JSON.stringify(list.body)).not.toContain("SUPER-SECRET-VALUE");
  });
});

describe("music-accounts router — CRUD and capacity", () => {
  it("creates, patches, and deletes", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/api/music-accounts")
      .send({ platform: "netease", label: "A", cookie: "c1" });
    const id = created.body.account.id;

    const patched = await request(app).patch(`/api/music-accounts/${id}`).send({ label: "B" });
    expect(patched.status).toBe(200);
    expect(patched.body.account.label).toBe("B");

    expect((await request(app).delete(`/api/music-accounts/${id}`)).status).toBe(200);
    expect((await request(app).get("/api/music-accounts")).body.accounts).toHaveLength(0);
  });

  it("rejects a missing cookie and an invalid capacity", async () => {
    const app = makeApp();
    expect((await request(app).post("/api/music-accounts").send({ platform: "netease" })).status).toBe(400);
    expect(
      (await request(app).post("/api/music-accounts").send({ platform: "netease", cookie: "c", capacity: -1 }))
        .status,
    ).toBe(400);
  });

  it("404s patching or deleting a missing account", async () => {
    const app = makeApp();
    expect((await request(app).patch("/api/music-accounts/999").send({ label: "x" })).status).toBe(404);
    expect((await request(app).delete("/api/music-accounts/999")).status).toBe(404);
  });

  it("409s assigning an exclusive account twice", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/api/music-accounts")
      .send({ platform: "netease", cookie: "c", capacity: 1 });
    const id = created.body.account.id;

    expect((await request(app).put(`/api/music-accounts/${id}/grants/u1`)).status).toBe(200);
    const second = await request(app).put(`/api/music-accounts/${id}/grants/u2`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("account_exclusive");
  });

  it("409s shrinking capacity below existing grants", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/api/music-accounts")
      .send({ platform: "netease", cookie: "c" });
    const id = created.body.account.id;
    await request(app).put(`/api/music-accounts/${id}/grants/u1`);
    await request(app).put(`/api/music-accounts/${id}/grants/u2`);

    const res = await request(app).patch(`/api/music-accounts/${id}`).send({ capacity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("capacity_below_existing_grants");
  });

  it("reports grantCount so the admin sees remaining capacity", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/api/music-accounts")
      .send({ platform: "netease", cookie: "c", capacity: 2 });
    const id = created.body.account.id;
    await request(app).put(`/api/music-accounts/${id}/grants/u1`);

    const list = await request(app).get("/api/music-accounts");
    expect(list.body.accounts[0].grantCount).toBe(1);
  });

  it("revokes a grant", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/api/music-accounts")
      .send({ platform: "netease", cookie: "c" });
    const id = created.body.account.id;
    await request(app).put(`/api/music-accounts/${id}/grants/u1`);

    expect((await request(app).delete(`/api/music-accounts/${id}/grants/u1`)).status).toBe(200);
    expect((await request(app).get("/api/music-accounts")).body.grants).toHaveLength(0);
  });

  it("404s revoking a grant that belongs to a different account", async () => {
    const app = makeApp();
    const a1 = (await request(app).post("/api/music-accounts").send({ platform: "netease", cookie: "c1" }))
      .body.account.id;
    const a2 = (await request(app).post("/api/music-accounts").send({ platform: "netease", cookie: "c2" }))
      .body.account.id;
    await request(app).put(`/api/music-accounts/${a1}/grants/u1`);

    expect((await request(app).delete(`/api/music-accounts/${a2}/grants/u1`)).status).toBe(404);
  });

  it("rejects a non-numeric id", async () => {
    expect((await request(makeApp()).delete("/api/music-accounts/abc")).status).toBe(400);
  });
});
