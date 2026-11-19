import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createDatabase, type BotDatabase } from "../../data/database.js";
import { createPlayerRouter } from "./player.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Play-history deletion: scoping, validation, and the guest contract. */

let db: BotDatabase;
let dir: string;

function seed(botId: string, names: string[]): void {
  for (const name of names) {
    db.addPlayHistory({
      botId,
      songId: `sid-${name}`,
      songName: name,
      artist: "A",
      album: "Al",
      platform: "netease",
      coverUrl: "",
      requestedBy: "",
      duration: 100,
    });
  }
}

function makeApp(database: BotDatabase | undefined, role = "admin") {
  const bot = {
    getPlayer: () => ({ stop: () => {}, resetFailures: () => {}, getState: () => "idle" }),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, role };
    (req as any).bot = bot;
    next();
  });
  app.use("/api/player", createPlayerRouter({ getBot: () => bot } as any, { error() {}, warn() {}, info() {} } as any, database));
  return app;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
  db = createDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("play history deletion", () => {
  it("exposes rowId alongside the platform song id", async () => {
    seed("b1", ["one"]);
    const res = await request(makeApp(db)).get("/api/player/b1/history");
    expect(res.status).toBe(200);
    expect(res.body.history[0].id).toBe("sid-one");
    expect(typeof res.body.history[0].rowId).toBe("number");
  });

  it("deletes a single row by rowId", async () => {
    seed("b1", ["one", "two"]);
    const list = await request(makeApp(db)).get("/api/player/b1/history");
    const rowId = list.body.history[0].rowId;

    const res = await request(makeApp(db)).delete(`/api/player/b1/history/${rowId}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);

    const after = await request(makeApp(db)).get("/api/player/b1/history");
    expect(after.body.history).toHaveLength(1);
  });

  it("deletes a batch of rows", async () => {
    seed("b1", ["one", "two", "three"]);
    const list = await request(makeApp(db)).get("/api/player/b1/history");
    const ids = list.body.history.slice(0, 2).map((r: any) => r.rowId);

    const res = await request(makeApp(db)).delete("/api/player/b1/history").send({ ids });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
  });

  it("clears the whole history with { all: true }", async () => {
    seed("b1", ["one", "two", "three"]);
    const res = await request(makeApp(db)).delete("/api/player/b1/history").send({ all: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
  });

  it("cannot delete another bot's rows even with a valid rowId", async () => {
    seed("b1", ["one"]);
    seed("b2", ["two"]);
    const b1 = await request(makeApp(db)).get("/api/player/b1/history");
    const b1RowId = b1.body.history[0].rowId;

    // b2 tries to delete b1's row by its primary key
    const res = await request(makeApp(db)).delete(`/api/player/b2/history/${b1RowId}`);
    expect(res.status).toBe(404);

    const stillThere = await request(makeApp(db)).get("/api/player/b1/history");
    expect(stillThere.body.history).toHaveLength(1);
  });

  it("rejects a non-numeric rowId instead of parseInt-coercing it", async () => {
    seed("b1", ["one"]);
    const res = await request(makeApp(db)).delete("/api/player/b1/history/12x");
    expect(res.status).toBe(400);
  });

  it("rejects a zero or negative rowId", async () => {
    expect((await request(makeApp(db)).delete("/api/player/b1/history/0")).status).toBe(400);
    expect((await request(makeApp(db)).delete("/api/player/b1/history/-1")).status).toBe(400);
  });

  it("rejects an ambiguous all + ids request", async () => {
    seed("b1", ["one"]);
    const res = await request(makeApp(db)).delete("/api/player/b1/history").send({ all: true, ids: [1] });
    expect(res.status).toBe(400);
  });

  it("rejects a batch containing any invalid entry (no silent partial delete)", async () => {
    seed("b1", ["one", "two"]);
    const list = await request(makeApp(db)).get("/api/player/b1/history");
    const good = list.body.history[0].rowId;

    const res = await request(makeApp(db)).delete("/api/player/b1/history").send({ ids: [good, "bad"] });
    expect(res.status).toBe(400);

    const after = await request(makeApp(db)).get("/api/player/b1/history");
    expect(after.body.history).toHaveLength(2);
  });

  it("rejects an empty batch and an oversized batch", async () => {
    expect((await request(makeApp(db)).delete("/api/player/b1/history").send({ ids: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    expect((await request(makeApp(db)).delete("/api/player/b1/history").send({ ids: tooMany })).status).toBe(400);
  });

  it("403s for a guest — a caller who cannot read must not delete", async () => {
    seed("b1", ["one"]);
    const res = await request(makeApp(db, "guest")).delete("/api/player/b1/history").send({ all: true });
    expect(res.status).toBe(403);
  });

  it("403s a guest on the single-row route too", async () => {
    seed("b1", ["one"]);
    const res = await request(makeApp(db, "guest")).delete("/api/player/b1/history/1");
    expect(res.status).toBe(403);
  });
});
