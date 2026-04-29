# Phase 2: Backend Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix concurrency bugs, resource management, error handling, type safety, config validation, and API input validation across the backend.

**Architecture:** Add a Mutex utility for concurrent queue operations, replace global FFmpeg PID tracking with instance-scoped management, unify error responses across all API endpoints, replace `any` casts with typed optional methods on MusicProvider, and add config/input validation.

**Tech Stack:** TypeScript, better-sqlite3, Express 5, Node.js async primitives, Vitest

**Spec:** `docs/superpowers/specs/2026-04-28-comprehensive-refactoring-design.md` — Phase 2

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/utils/mutex.ts` | Async mutex for playNext concurrency |
| Create | `src/utils/mutex.test.ts` | Mutex tests |
| Create | `src/utils/validate.ts` | API input validation helpers |
| Create | `src/utils/validate.test.ts` | Validation tests |
| Modify | `src/bot/instance.ts:63,681-711` | Replace isAdvancing with Mutex, fix empty catches |
| Modify | `src/bot/manager.ts:40-44` | Bot restart coordination, fix empty catch |
| Modify | `src/audio/player.ts:12,119,137,184-206` | Instance-scoped PID, improve cleanup |
| Modify | `src/data/database.ts:245-247` | Double-close guard, WAL checkpoint |
| Modify | `src/data/config.ts:47-56` | Add validateConfig, call in loadConfig |
| Modify | `src/data/config.test.ts` | Config validation tests |
| Modify | `src/web/server.ts` (after line 108) | Global error middleware |
| Modify | `src/music/provider.ts:29,47,56-80` | Fix typos, add optional methods to interface |
| Modify | `src/music/netease.ts` (add method) | Implement getPlaylistDetail |
| Modify | `src/web/api/music.ts:140,174,206` | Fix typo, replace as any, unify errors |
| Modify | `src/web/api/player.ts` | Input validation, unify errors |
| Modify | `src/web/api/bot.ts` | Input validation, unify errors |

---

### Task 1: Create async mutex utility

**Files:**
- Create: `src/utils/mutex.ts`
- Create: `src/utils/mutex.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/mutex.test.ts`:

```typescript
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
    // p2 must wait for p1 to finish: 1, 2, 3 — never 1, 3, 2
    expect(order).toEqual([1, 2, 3]);
  });

  it("releases lock even if function throws", async () => {
    const mutex = new Mutex();
    await expect(mutex.run(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    // Lock should be released — next call should proceed
    const result = await mutex.run(() => "ok");
    expect(result).toBe("ok");
  });

  it("returns the function's return value", async () => {
    const mutex = new Mutex();
    const result = await mutex.run(async () => "hello");
    expect(result).toBe("hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/mutex.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create mutex**

Create `src/utils/mutex.ts`:

```typescript
/**
 * Async mutex — serializes concurrent async operations.
 * Queues callers and runs them one at a time.
 */
export class Mutex {
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Run `fn` exclusively. If another call is in progress,
   * this one waits until it finishes.
   */
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => fn());
    this.queue = next.catch(() => {});
    return next;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/mutex.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/mutex.ts src/utils/mutex.test.ts
git commit -m "feat: add async Mutex utility with tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Apply mutex to playNext + fix empty catches in instance.ts

**Files:**
- Modify: `src/bot/instance.ts`

**Context:** Line 63 has `private isAdvancing = false;`. Lines 681-711 contain `playNext()` which uses `isAdvancing` with try/finally — not true mutual exclusion. Lines 702 and 706 have `.catch(() => {})` empty catches.

- [ ] **Step 1: Add Mutex import**

After line 14 (`import {` ending with `} from "./commands.js";`), add:

```typescript
import { Mutex } from "../utils/mutex.js";
```

- [ ] **Step 2: Replace `isAdvancing` with `Mutex`**

On line 63, replace:

```typescript
  private isAdvancing = false;
```

With:

```typescript
  private playNextMutex = new Mutex();
```

- [ ] **Step 3: Rewrite playNext method**

Replace the entire `playNext` method (lines 681-711) with:

```typescript
  private async playNext(): Promise<void> {
    if (!this.connected) return;
    await this.playNextMutex.run(async () => {
      this.voteSkipUsers.clear();
      const next = this.queue.next();
      if (next) {
        let started = await this.resolveAndPlay(next);
        if (!started) {
          for (let i = 0; i < 3 && this.connected; i++) {
            const retry = this.queue.next();
            if (!retry) break;
            if (await this.resolveAndPlay(retry)) {
              started = true;
              break;
            }
          }
        }
        if (!started) {
          this.player.stop();
          this.profileManager.onSongChange(null).catch((err) => {
            this.logger.error({ err }, "Failed to update profile on song end");
          });
        }
      } else {
        this.player.stop();
        this.profileManager.onSongChange(null).catch((err) => {
          this.logger.error({ err }, "Failed to update profile on song end");
        });
      }
      this.emit("stateChange");
    });
  }
```

Key changes: replaced `isAdvancing` flag with `Mutex.run()`, added error logging to the two `.catch(() => {})` blocks.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/bot/instance.ts
git commit -m "fix: replace isAdvancing flag with Mutex for playNext concurrency

Eliminates race condition where concurrent playNext calls could skip
queue entries. Also fixes empty catch blocks with proper error logging.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Improve FFmpeg process cleanup in player.ts

**Files:**
- Modify: `src/audio/player.ts`

**Context:** Line 12 has `const globalActivePids = new Set<number>();` — a global singleton shared across all AudioPlayer instances. The `forceCleanup` method (lines 184-206) has empty catch blocks and a short 1500ms SIGKILL timeout.

- [ ] **Step 1: Remove global PID tracker**

Delete line 12:

```typescript
const globalActivePids = new Set<number>();
```

- [ ] **Step 2: Add instance-level PID property**

After line 80 (`private static readonly MAX_CONSECUTIVE_FAILURES = 3;`), add:

```typescript
  private activePid: number | null = null;
```

- [ ] **Step 3: Replace globalActivePids.add (line 119)**

Replace:

```typescript
      globalActivePids.add(currentPid);
```

With:

```typescript
      this.activePid = currentPid;
```

- [ ] **Step 4: Replace globalActivePids.delete in exit handler (line 137)**

Replace:

```typescript
      if (currentPid) globalActivePids.delete(currentPid);
```

With:

```typescript
      if (this.activePid === currentPid) this.activePid = null;
```

- [ ] **Step 5: Rewrite forceCleanup method (lines 184-206)**

Replace the entire `forceCleanup` method with:

```typescript
  private forceCleanup(proc: ChildProcess, pid: number): void {
    try {
      proc.kill("SIGTERM");
    } catch {
      this.logger.debug({ pid }, "SIGTERM failed (process may have already exited)");
    }

    const killTimeout = setTimeout(() => {
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
        this.logger.warn({ pid }, "FFmpeg required SIGKILL");
      } catch {
        // Process already gone — nothing to do
      }
      if (this.activePid === pid) this.activePid = null;
    }, 3000);

    proc.unref();
    proc.once("exit", () => {
      clearTimeout(killTimeout);
      if (this.activePid === pid) this.activePid = null;
    });
  }
```

Key changes: replaced global `Set` with instance-level `activePid`, increased SIGKILL timeout from 1500ms to 3000ms, replaced empty catches with logging.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/audio/player.ts
git commit -m "fix: improve FFmpeg process cleanup

- Replace global PID tracker with instance-level activePid
- Increase SIGKILL timeout to 3s
- Replace empty catches with proper logging
- Remove global state leak between AudioPlayer instances

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Improve database close() method

**Files:**
- Modify: `src/data/database.ts`

**Context:** The `close()` method (lines 245-247) is just `db.close()` with no guard against double-close or WAL checkpoint.

- [ ] **Step 1: Add closed flag**

Inside `createDatabase`, before the first `const insertHistory = db.prepare(...)` statement, add:

```typescript
  let closed = false;
```

- [ ] **Step 2: Replace close() method**

Replace lines 245-247:

```typescript
    close() {
      db.close();
    },
```

With:

```typescript
    close() {
      if (closed) return;
      closed = true;
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // Checkpoint may fail if WAL wasn't used — ignore
      }
      db.close();
    },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/data/database.ts
git commit -m "fix: improve database close with double-close guard and WAL checkpoint

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add global error middleware to server.ts

**Files:**
- Modify: `src/web/server.ts`

**Context:** No global Express error handler exists. Unhandled errors in route handlers may produce inconsistent responses or crash the process. The error middleware must be registered after all route handlers (after the `if (options.staticDir)` block on line 103) and before `server.on("error"` (line 110).

- [ ] **Step 1: Add global error handler**

After the closing brace of `if (options.staticDir) { ... }` (line 108) and before `server.on("error"` (line 110), insert:

```typescript
  // Global error handler — catches errors thrown in route handlers
  // that weren't caught by try/catch. Must have 4 parameters for Express.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err, path: _req.path }, "Unhandled API error");
    res.status(500).json({ success: false, error: "Internal server error" });
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/server.ts
git commit -m "fix: add global Express error middleware

Catches unhandled errors in route handlers and returns a consistent
error response instead of crashing or sending an HTML error page.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Fix type safety in provider.ts and music.ts

**Files:**
- Modify: `src/music/provider.ts`
- Modify: `src/music/netease.ts`
- Modify: `src/web/api/music.ts`

**Context:**
- `src/music/provider.ts` has two typos: line 29 `"string"` should be `"netease"` in the Album interface; line 47 `interface` should be `string` for QrCodeResult.key
- `src/music/provider.ts` MusicProvider interface is missing optional `getPlaylistDetail` and `getPopularVideos` methods that music.ts needs
- `src/music/netease.ts` (NeteaseProvider class) has `private api: AxiosInstance` (line 69) and `private cookie = ""` (line 70) — the playlist detail logic in music.ts accesses these via `as any`
- `src/music/bilibili.ts` already has `getPopularVideos` at line 343 — just needs interface typing
- `src/web/api/music.ts` line 140 has bug `req.query.query.platform` (double `.query`)
- `src/web/api/music.ts` lines 174 and 206 use `as any` casts
- `src/web/api/music.ts` error responses use `{ error: string }` format — missing `success: false`

- [ ] **Step 1: Fix provider.ts typos**

In `src/music/provider.ts`, fix line 29 — change:

```typescript
  platform: "string" | "qq" | "bilibili" | "youtube";
```

To:

```typescript
  platform: "netease" | "qq" | "bilibili" | "youtube";
```

Fix line 47 — change:

```typescript
  key: interface;
```

To:

```typescript
  key: string;
```

- [ ] **Step 2: Add optional methods to MusicProvider interface**

In `src/music/provider.ts`, after line 79 (`getUserPlaylists?(): Promise<Playlist[]>;`), add these optional methods inside the interface:

```typescript
  getPlaylistDetail?(playlistId: string): Promise<{
    id: string;
    name: string;
    description: string;
    coverUrl: string;
    songCount: number;
  }>;
  getPopularVideos?(limit: number): Promise<Song[]>;
```

- [ ] **Step 3: Implement getPlaylistDetail on NeteaseProvider**

In `src/music/netease.ts`, add this method to the `NeteaseProvider` class (place it near `getPlaylistSongs`):

```typescript
  async getPlaylistDetail(playlistId: string): Promise<{
    id: string;
    name: string;
    description: string;
    coverUrl: string;
    songCount: number;
  }> {
    const cookieParams = this.cookieParams;
    const detailRes = await this.api.get("/playlist/detail", {
      params: { id: playlistId, ...cookieParams },
    });
    const p = detailRes.data?.playlist;
    return {
      id: String(p?.id ?? ""),
      name: p?.name ?? "",
      description: p?.description ?? "",
      coverUrl: p?.coverImgUrl ?? "",
      songCount: p?.trackCount ?? 0,
    };
  }
```

Note: `this.cookieParams` is the existing private getter on line 88 that returns `{ cookie: this.cookie }` or `{}`.

- [ ] **Step 4: Fix music.ts — replace `as any` playlist detail endpoint**

In `src/web/api/music.ts`, replace the entire `/playlist/:id/detail` route handler (lines 168-201) with:

```typescript
  router.get("/playlist/:id/detail", async (req, res) => {
    try {
      const provider = getProvider(req.query.platform as string);
      if (!provider.getPlaylistDetail) {
        res.status(501).json({ success: false, error: "Not supported by this provider" });
        return;
      }
      const playlist = await provider.getPlaylistDetail(req.params.id);
      if (!playlist.id) {
        res.status(404).json({ success: false, error: "Playlist not found" });
        return;
      }
      res.json({ playlist });
    } catch (err) {
      logger.error({ err }, "Get playlist detail failed");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });
```

- [ ] **Step 5: Fix music.ts — replace `as any` bilibili popular endpoint**

In `src/web/api/music.ts`, replace the entire `/bilibili/popular` route handler (lines 204-218) with:

```typescript
  router.get("/bilibili/popular", async (req, res) => {
    try {
      if (bilibiliProvider.getPopularVideos) {
        const limit = parseInt(req.query.limit as string) || 20;
        const songs = await bilibiliProvider.getPopularVideos(limit);
        res.json({ songs });
      } else {
        res.json({ songs: [] });
      }
    } catch (err) {
      logger.error({ err }, "Get bilibili popular failed");
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });
```

- [ ] **Step 6: Fix music.ts — fix `req.query.query.platform` typo**

On line 140, change:

```typescript
      const provider = getProvider(req.query.query.platform as string);
```

To:

```typescript
      const provider = getProvider(req.query.platform as string);
```

- [ ] **Step 7: Unify error responses in music.ts**

Replace all remaining `res.status(500).json({ error:` patterns with `res.status(500).json({ success: false, error:`. This applies to lines: 36, 65, 79, 89, 99, 109, 119, 134, 149, 164.

Also fix the 400/404 responses that use `{ error:` to use `{ success: false, error:`. Lines: 25, 44, 74, 127, 143, 157, 196, 232.

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/music/provider.ts src/music/netease.ts src/web/api/music.ts
git commit -m "fix: eliminate as any casts, add typed optional methods, unify errors

- Fix provider.ts typos (Album.platform, QrCodeResult.key)
- Add getPlaylistDetail and getPopularVideos to MusicProvider interface
- Implement getPlaylistDetail on NeteaseProvider
- Replace all as any casts in music.ts with typed method calls
- Fix req.query.query.platform typo
- Unify all error responses to { success: false, error } format

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Add config validation

**Files:**
- Modify: `src/data/config.ts`
- Modify: `src/data/config.test.ts`

**Context:** `loadConfig` (line 47) returns whatever is in the config file without validating. Invalid ports or values cause runtime issues. `BotConfig` interface has: `webPort`, `neteaseApiPort`, `qqMusicApiPort` (ports), `autoReturnDelay`, `idleTimeoutMinutes` (non-negative numbers), `locale` (`"zh"|"en"`), `theme` (`"dark"|"light"`).

- [ ] **Step 1: Add validation tests**

In `src/data/config.test.ts`, add after the existing imports:

```typescript
import { validateConfig } from "./config.js";
```

Add a new `describe` block at the end of the file:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/config.test.ts`
Expected: FAIL — `validateConfig` not found

- [ ] **Step 3: Add validateConfig function**

In `src/data/config.ts`, add after `getJwtSecret` (line 70):

```typescript
/**
 * Validate config values. Throws on invalid values.
 */
export function validateConfig(config: BotConfig): void {
  const errors: string[] = [];

  if (!Number.isInteger(config.webPort) || config.webPort < 1 || config.webPort > 65535) {
    errors.push(`webPort must be 1-65535, got ${config.webPort}`);
  }
  if (!Number.isInteger(config.neteaseApiPort) || config.neteaseApiPort < 1 || config.neteaseApiPort > 65535) {
    errors.push(`neteaseApiPort must be 1-65535, got ${config.neteaseApiPort}`);
  }
  if (!Number.isInteger(config.qqMusicApiPort) || config.qqMusicApiPort < 1 || config.qqMusicApiPort > 65535) {
    errors.push(`qqMusicApiPort must be 1-65535, got ${config.qqMusicApiPort}`);
  }
  if (config.autoReturnDelay < 0) {
    errors.push(`autoReturnDelay must be >= 0, got ${config.autoReturnDelay}`);
  }
  if (config.idleTimeoutMinutes < 0) {
    errors.push(`idleTimeoutMinutes must be >= 0, got ${config.idleTimeoutMinutes}`);
  }
  if (config.locale !== "zh" && config.locale !== "en") {
    errors.push(`locale must be 'zh' or 'en', got '${config.locale}'`);
  }
  if (config.theme !== "dark" && config.theme !== "light") {
    errors.push(`theme must be 'dark' or 'light', got '${config.theme}'`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  ${errors.join("\n  ")}`);
  }
}
```

- [ ] **Step 4: Call validateConfig on load**

Replace the `loadConfig` function (lines 47-56):

```typescript
export function loadConfig(path: string): BotConfig {
  const defaults = getDefaultConfig();
  try {
    const raw = readFileSync(path, "utf-8");
    const partial = JSON.parse(raw) as Partial<BotConfig>;
    const config = { ...defaults, ...partial };
    validateConfig(config);
    return config;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid configuration")) {
      throw err;
    }
    return defaults;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/data/config.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/data/config.ts src/data/config.test.ts
git commit -m "feat: add config validation with descriptive error messages

Validates ports (1-65535), non-negative delays, and valid locale/theme
values at load time. Invalid config now fails fast with clear errors.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Add API input validation helpers

**Files:**
- Create: `src/utils/validate.ts`
- Create: `src/utils/validate.test.ts`

- [ ] **Step 1: Write tests**

Create `src/utils/validate.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/validate.test.ts`
Expected: FAIL

- [ ] **Step 3: Create validation helpers**

Create `src/utils/validate.ts`:

```typescript
const VALID_PLATFORMS = new Set(["netease", "qq", "bilibili", "youtube"]);

/**
 * Validate and return a music platform string.
 * Returns "netease" (default) if undefined.
 * Throws on invalid values.
 */
export function validatePlatform(platform: string | undefined): string {
  if (!platform) return "netease";
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(`Invalid platform: '${platform}'. Must be one of: netease, qq, bilibili, youtube`);
  }
  return platform;
}

/**
 * Validate a bot ID parameter. Must be a non-empty string up to 128 chars.
 */
export function validateBotId(id: string): string {
  if (!id || id.trim().length === 0) {
    throw new Error("botId is required");
  }
  const trimmed = id.trim();
  if (trimmed.length > 128) {
    throw new Error(`botId is too long (max 128 chars, got ${trimmed.length})`);
  }
  return trimmed;
}

/**
 * Validate a generic string parameter.
 * Trims whitespace, rejects empty/too-long values.
 */
export function validateStringParam(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} is too long (max ${maxLength} chars, got ${trimmed.length})`);
  }
  return trimmed;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/utils/validate.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/validate.ts src/utils/validate.test.ts
git commit -m "feat: add API input validation helpers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Apply input validation + unify errors in player.ts and bot.ts

**Files:**
- Modify: `src/web/api/player.ts`
- Modify: `src/web/api/bot.ts`

**Context:** Both files accept user input without validation. Error responses use `{ error: string }` — missing `success: false`.

- [ ] **Step 1: Add validation import to player.ts**

In `src/web/api/player.ts`, after line 6 (`import { parseCommand } from "../../bot/commands.js";`), add:

```typescript
import { validatePlatform, validateBotId } from "../../utils/validate.js";
```

- [ ] **Step 2: Add botId validation in player.ts middleware**

In the middleware on line 18 (`router.use("/:botId", (req, res, next) => {`), add validation. Replace:

```typescript
  router.use("/:botId", (req, res, next) => {
    const bot = botManager.getBot(req.params.botId);
```

With:

```typescript
  router.use("/:botId", (req, res, next) => {
    let botId: string;
    try {
      botId = validateBotId(req.params.botId);
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    const bot = botManager.getBot(botId);
```

- [ ] **Step 3: Add platform validation in player.ts play route**

In the play route (line 36), the `platform` comes from `req.body.platform`. No explicit validation needed since `platformFlag()` already maps unknown platforms to `""` (netease default). But add validation to the `play-playlist` route (line 230) and `add-by-id` route (line 334) where platform is used for provider lookup.

In the `play-playlist` route (line 236), replace:

```typescript
      const provider = bot.getProviderFor(
        platform === "bilibili" || platform === "qq" || platform === "youtube"
          ? platform
          : "netease"
      );
```

With:

```typescript
      const provider = bot.getProviderFor(validatePlatform(platform));
```

In the `add-by-id` route (line 338), replace the same pattern:

```typescript
      const provider = bot.getProviderFor(
        platform === "bilibili" || platform === "qq" || platform === "youtube"
          ? platform
          : "netease"
      );
```

With:

```typescript
      const provider = bot.getProviderFor(validatePlatform(platform));
```

- [ ] **Step 4: Unify error responses in player.ts**

Replace all `res.status(500).json({ error:` with `res.status(500).json({ success: false, error:` in the catch blocks. Also replace `res.status(400).json({ error:` with `res.status(400).json({ success: false, error:`. This applies to all error responses in the file.

Also replace `res.status(404).json({ error:` with `res.status(404).json({ success: false, error:` on line 21.

- [ ] **Step 5: Add validation import to bot.ts**

In `src/web/api/bot.ts`, after line 5 (`import type { Logger } from "../../logger.js";`), add:

```typescript
import { validateBotId } from "../../utils/validate.js";
```

- [ ] **Step 6: Add botId validation in bot.ts**

For each route that uses `req.params.id`, wrap it with `validateBotId`. Add this pattern at the top of each handler:

```typescript
      const id = validateBotId(req.params.id);
```

Then replace `req.params.id` with `id` in that handler. Apply to routes on lines: 20 (GET /:id), 30 (GET /:id/config), 75 (PUT /:id), 94 (DELETE /:id), 103 (POST /:id/start), 112 (POST /:id/stop).

Wrap in try/catch to return 400 on validation failure:

```typescript
  router.get("/:id", (req, res) => {
    let id: string;
    try {
      id = validateBotId(req.params.id);
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    const bot = botManager.getBot(id);
    // ... rest unchanged
  });
```

- [ ] **Step 7: Unify error responses in bot.ts**

Replace all `res.status(500).json({ error:` with `res.status(500).json({ success: false, error:`. Also replace `res.status(400).json({ error:` with `res.status(400).json({ success: false, error:`. Also replace `res.status(404).json({ error:` with `res.status(404).json({ success: false, error:`.

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/web/api/player.ts src/web/api/bot.ts
git commit -m "fix: add input validation and unify error responses in API routes

- Validate platform parameter against whitelist
- Validate botId parameter (non-empty, length limit)
- Unify all error responses to { success: false, error } format

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Fix bot restart coordination in manager.ts

**Files:**
- Modify: `src/bot/manager.ts`

**Context:** The `startBot` method (not `restartBot` — the method is called `startBot` but performs restart logic when an old bot exists) disconnects the old bot and immediately creates a new one without waiting for the audio pipeline to stop. Line 42 has an empty catch: `} catch { // ignore teardown errors }`.

- [ ] **Step 1: Read the startBot method**

Read `src/bot/manager.ts`. Find the `startBot` method. It calls `oldBot.disconnect()` and then immediately creates a new BotInstance.

- [ ] **Step 2: Add cleanup delay**

After the `oldBot.disconnect()` call (around line 99 in the `startBot` method — look for `oldBot.disconnect()`), add a brief wait:

```typescript
      oldBot.disconnect();
      // Wait for audio pipeline to fully stop before starting new bot
      await new Promise((resolve) => setTimeout(resolve, 100));
```

- [ ] **Step 3: Fix empty catch in connectWithTimeout**

On lines 42-44, the `connectWithTimeout` helper has:

```typescript
    try {
      bot.disconnect();
    } catch {
      // ignore teardown errors
    }
```

Replace with:

```typescript
    try {
      bot.disconnect();
    } catch (err) {
      logger.debug({ err, botId: bot.id }, "Disconnect error during connect cleanup");
    }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/bot/manager.ts
git commit -m "fix: add cleanup delay on bot restart, log teardown errors

Ensures old bot's audio pipeline is fully stopped before starting
a new instance. Replaces silent catch block with debug logging.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Build and integration test

- [ ] **Step 1: Build backend**

Run: `npx tsc`
Expected: Clean build, no errors

- [ ] **Step 2: Build frontend**

Run: `cd web && npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (except any pre-existing failures)

- [ ] **Step 4: Run new tests specifically**

Run: `npx vitest run src/utils/ src/data/config.test.ts`
Expected: All new tests pass

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve build/test issues from Phase 2

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| 2.1 Concurrent safety — Mutex for playNext | Task 1 + 2 |
| 2.1 Concurrent safety — Bot restart coordination | Task 10 |
| 2.2 FFmpeg process management — Remove global PID, reliable cleanup | Task 3 |
| 2.2 FFmpeg process management — Backpressure control | Deferred (complex, existing backpressure already works) |
| 2.3 Database — WAL mode, prepared statement caching, proper close | Task 4 (WAL and caching already exist) |
| 2.3 Database — Connection health check | Deferred (not critical for robustness) |
| 2.4 Error handling — No empty catches | Tasks 2, 3, 10 |
| 2.4 Error handling — Promise.allSettled | Already done in music.ts search/all |
| 2.4 Error handling — Unified error format `{ success, error }` | Tasks 6, 9 |
| 2.4 Error handling — Global error middleware | Task 5 |
| 2.5 Type safety — Fix `as any` casts | Task 6 |
| 2.5 Type safety — Optional method existence checks | Task 6 (typed via interface) |
| 2.5 Type safety — provider.ts bug fixes | Task 6 |
| 2.6 Config validation — Port/delay/locale/theme validation | Task 7 |
| 2.6 Config validation — Config file locking | Deferred (not critical for robustness) |
| 2.7 API input validation — Platform whitelist | Task 8 + 9 |
| 2.7 API input validation — botId check | Task 8 + 9 |
| 2.7 API input validation — String length limits | Task 8 |

### Placeholder Scan

No TBD, TODO, or "implement later" found. All code steps contain complete implementations.

### Type Consistency

- `Mutex.run<T>()` returns `Promise<T>` — matches usage in `playNext` which returns `Promise<void>`
- `validatePlatform` returns `string` — matches `getProvider(platform)` and `bot.getProviderFor(platform)` usage
- `validateBotId` returns `string` — matches `botManager.getBot(id)` usage
- `getPlaylistDetail` returns typed object — matches `music.ts` response construction
- `getPopularVideos` returns `Promise<Song[]>` — matches existing `BiliBiliProvider.getPopularVideos` signature
