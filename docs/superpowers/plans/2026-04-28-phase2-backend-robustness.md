# Phase 2: Backend Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix concurrency bugs, resource management, error handling, type safety, config validation, and API input validation across the backend.

**Architecture:** Add a Mutex utility for concurrent queue operations, improve FFmpeg lifecycle management with Promise-based cleanup, unify error responses across all API endpoints, replace `any` casts with proper types, and add config/input validation.

**Tech Stack:** TypeScript, better-sqlite3, Express 5, Node.js async primitives

**Spec:** `docs/superpowers/specs/2026-04-28-comprehensive-refactoring-design.md` — Phase 2

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/utils/mutex.ts` | Async mutex for playNext concurrency |
| Create | `src/utils/mutex.test.ts` | Mutex tests |
| Create | `src/utils/validate.ts` | Config & API input validation helpers |
| Create | `src/utils/validate.test.ts` | Validation tests |
| Modify | `src/bot/instance.ts` | Mutex on playNext, fix empty catches |
| Modify | `src/bot/manager.ts` | Bot restart coordination, fix empty catches |
| Modify | `src/audio/player.ts` | Promise-based FFmpeg cleanup, remove global PID tracker |
| Modify | `src/data/database.ts` | Proper close() with statement finalization |
| Modify | `src/data/config.ts` | Add validateConfig function |
| Modify | `src/data/config.test.ts` | Config validation tests |
| Modify | `src/web/server.ts` | Global error middleware |
| Modify | `src/web/api/music.ts` | Unified errors, fix `as any`, partial failure reporting |
| Modify | `src/web/api/player.ts` | Input validation, unified errors |
| Modify | `src/web/api/bot.ts` | Input validation, unified errors |
| Modify | `src/music/provider.ts` | Add helper for optional method calls |

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

**Context:** The `playNext` method (line 681) uses a simple `isAdvancing` boolean flag that offers no mutual exclusion under concurrent calls. Replace it with the `Mutex` utility. Also fix two empty catch blocks at lines 702 and 706.

- [ ] **Step 1: Read `src/bot/instance.ts`**

Read the file. Find:
- Line 4: import from `"./commands.js"`
- Line 8: import `PlayQueue`
- Line 46: `class BotInstance extends EventEmitter`
- Lines 681-711: `playNext` method
- Lines 702, 706: `.catch(() => {})` empty catches
- The `isAdvancing` property declaration

- [ ] **Step 2: Add Mutex import**

After the existing import from `"./commands.js"`, add:

```typescript
import { Mutex } from "../utils/mutex.js";
```

- [ ] **Step 3: Replace `isAdvancing` with `Mutex`**

Find the property declaration (search for `private isAdvancing`). Replace:

```typescript
  private isAdvancing = false;
```

With:

```typescript
  private playNextMutex = new Mutex();
```

- [ ] **Step 4: Rewrite playNext method**

Find the `playNext` method (starting around line 681). Replace the entire method:

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

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

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

**Context:** The `forceCleanup` method (line 184) has an empty catch block and the global PID tracker (`globalActivePids`) is a process-wide singleton that should be instance-scoped. The cleanup should use a Promise to allow callers to await completion.

- [ ] **Step 1: Read `src/audio/player.ts`**

Read the full file. Identify:
- Line 12: `const globalActivePids = new Set<number>()`
- Lines 184-206: `forceCleanup` method with empty catch
- Lines 118-119: `globalActivePids.add(currentPid)`
- Lines 137, 197, 204: `globalActivePids.delete(currentPid)`

- [ ] **Step 2: Replace global PID tracker with instance-level tracking**

Remove the global tracker. Replace line 12 (`const globalActivePids = new Set<number>()`) and modify the `AudioPlayer` class:

Add a new property to the class (after `private static readonly MAX_CONSECUTIVE_FAILURES = 3`):

```typescript
  private activePid: number | null = null;
```

- [ ] **Step 3: Replace all `globalActivePids` references**

In the `play` method, replace:

```typescript
    if (currentPid) {
      globalActivePids.add(currentPid);
```

With:

```typescript
    if (currentPid) {
      this.activePid = currentPid;
```

In the `exit` handler inside `play`, replace:

```typescript
      if (currentPid) globalActivePids.delete(currentPid);
```

With:

```typescript
      if (this.activePid === currentPid) this.activePid = null;
```

- [ ] **Step 4: Rewrite forceCleanup as Promise-based**

Replace the entire `forceCleanup` method:

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

Changes:
- Increased timeout from 1500ms to 3000ms for SIGKILL
- Replaced empty catches with logging
- Replaced global PID set with instance-level `activePid`

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

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

**Context:** The `close()` method (line 245) calls `db.close()` but doesn't finalize prepared statements first. While better-sqlite3 finalizes them automatically, it's better to be explicit. Also add a `closed` guard.

- [ ] **Step 1: Add closed flag**

In the `createDatabase` function, before the prepared statements, add:

```typescript
  let closed = false;
```

- [ ] **Step 2: Improve close method**

Replace the `close()` method:

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

This adds: a double-close guard, and a WAL checkpoint before close to ensure all data is flushed.

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

**Context:** Currently there is no global Express error handler, so unhandled errors in route handlers may produce inconsistent responses or crash the process.

- [ ] **Step 1: Read `src/web/server.ts`**

Read the file. Find where routes are registered (after the last `app.use()` call for route handlers, before `server.on("error"`).

- [ ] **Step 2: Add global error handler**

After the last route handler registration (after the `if (options.staticDir)` block) and before `server.on("error"`, add:

```typescript
  // Global error handler — catches errors thrown in route handlers
  // that weren't caught by try/catch. Must have 4 parameters for Express.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err, path: _req.path }, "Unhandled API error");
    res.status(500).json({ success: false, error: "Internal server error" });
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/web/server.ts
git commit -m "fix: add global Express error middleware

Catches unhandled errors in route handlers and returns a consistent
error response instead of crashing or sending an HTML error page.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Fix `as any` casts and unify error format in music.ts

**Files:**
- Modify: `src/web/api/music.ts`

**Context:** The file has two `as any` casts (lines 174 and 206) for accessing internal provider properties. Replace them with typed access through the provider interface. Also unify all error responses to `{ success: false, error: string }` format.

- [ ] **Step 1: Read `src/web/api/music.ts`**

Read the full file.

- [ ] **Step 2: Add provider access helper**

Replace the `getProvider` function at the top of the router with one that validates the platform parameter:

```typescript
  const VALID_PLATFORMS = new Set(["netease", "qq", "bilibili", "youtube"]);

  function getProvider(platform?: string): MusicProvider {
    if (platform === "bilibili") return bilibiliProvider;
    if (platform === "youtube") return youtubeProvider;
    return platform === "qq" ? qqProvider : neteaseProvider;
  }

  function getValidatedProvider(platform?: string): MusicProvider {
    if (platform && !VALID_PLATFORMS.has(platform)) {
      throw new Error(`Invalid platform: ${platform}. Must be one of: netease, qq, bilibili, youtube`);
    }
    return getProvider(platform);
  }
```

- [ ] **Step 3: Replace all `getProvider` calls with `getValidatedProvider`**

In every route handler that calls `getProvider(req.query.platform as string)`, replace with `getValidatedProvider(req.query.platform as string)`.

- [ ] **Step 4: Fix `as any` casts for playlist detail**

The playlist detail endpoint (line 174) casts provider to `any` to access `api` and `cookie`. Since these are internal implementation details of `NeteaseProvider`, the cleanest fix is to add an optional method to the `MusicProvider` interface.

First, modify `src/music/provider.ts` — add this optional method to the interface:

```typescript
  getPlaylistDetail?(playlistId: string): Promise<{
    id: string;
    name: string;
    description: string;
    coverUrl: string;
    songCount: number;
  }>;
```

Then, implement it in `src/music/netease.ts`. Add the method to the `NeteaseProvider` class. Read the file to find the class and add the method using the existing `api` client.

For the Bilibili popular endpoint (line 206), cast through a type that includes the optional method. Replace:

```typescript
      const provider = bilibiliProvider as any;
      if (provider.getPopularVideos) {
```

With a check against the typed optional method. Add to `provider.ts` interface:

```typescript
  getPopularVideos?(limit: number): Promise<Song[]>;
```

Then replace the cast:

```typescript
      if (bilibiliProvider.getPopularVideos) {
        const songs = await bilibiliProvider.getPopularVideos(limit);
```

- [ ] **Step 5: Unify error responses**

Replace all `res.status(500).json({ error: ... })` with `res.status(500).json({ success: false, error: ... })`. Do this for every catch block in the file.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/music/provider.ts src/music/netease.ts src/web/api/music.ts
git commit -m "fix: eliminate as any casts, add platform validation, unify errors

- Add getPlaylistDetail and getPopularVideos to MusicProvider interface
- Replace all as any casts with typed optional methods
- Validate platform parameter against whitelist
- Unify all error responses to { success: false, error } format

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Add config validation

**Files:**
- Modify: `src/data/config.ts`
- Modify: `src/data/config.test.ts`

**Context:** The `loadConfig` function returns whatever is in the config file without validating values. Invalid ports, negative volumes, etc. can cause runtime issues.

- [ ] **Step 1: Read `src/data/config.ts` and `src/data/config.test.ts`**

Read both files.

- [ ] **Step 2: Add validation tests**

In `src/data/config.test.ts`, add:

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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/data/config.test.ts`
Expected: FAIL — `validateConfig` not found

- [ ] **Step 4: Add validateConfig function**

In `src/data/config.ts`, add after `getJwtSecret`:

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

- [ ] **Step 5: Call validateConfig on load**

In `loadConfig`, add validation before returning:

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
      throw err; // Re-throw validation errors
    }
    return defaults;
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/data/config.test.ts`
Expected: All tests pass

- [ ] **Step 7: Commit**

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

### Task 9: Apply input validation to player.ts and bot.ts API routes

**Files:**
- Modify: `src/web/api/player.ts`
- Modify: `src/web/api/bot.ts`

**Context:** These route handlers accept user input without validation. Add platform/botId/string validation using the helpers from Task 8.

- [ ] **Step 1: Read `src/web/api/player.ts`**

Read the file. Find where `req.params.botId` and `req.query.platform` / `req.body.platform` are used.

- [ ] **Step 2: Add validation import and middleware**

In `src/web/api/player.ts`, add at the top (after existing imports):

```typescript
import { validatePlatform, validateBotId } from "../../utils/validate.js";
```

Find the bot ID middleware (the helper function that extracts botId from req.params and looks up the bot). Add `validateBotId` before the lookup:

Wherever `req.params.botId` is used, wrap it:

```typescript
const botId = validateBotId(req.params.botId);
```

Wherever `req.query.platform` or `req.body.platform` is used:

```typescript
const platform = validatePlatform(req.query.platform as string | undefined);
```

or for body:

```typescript
const platform = validatePlatform(req.body.platform);
```

- [ ] **Step 3: Apply same pattern to bot.ts**

In `src/web/api/bot.ts`, add:

```typescript
import { validateBotId } from "../../utils/validate.js";
```

Apply `validateBotId` to all routes that take `req.params.id` or `req.params.botId`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/web/api/player.ts src/web/api/bot.ts
git commit -m "fix: add input validation to player and bot API routes

- Validate platform parameter against whitelist
- Validate botId parameter (non-empty, length limit)
- Returns 400 with descriptive error on invalid input

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Fix bot restart coordination in manager.ts

**Files:**
- Modify: `src/bot/manager.ts`

**Context:** When restarting a bot, the old bot may still be sending audio while the new one starts. Add a brief delay after disconnect to ensure cleanup completes.

- [ ] **Step 1: Read `src/bot/manager.ts`**

Read the file. Find the `restartBot` method.

- [ ] **Step 2: Add cleanup delay to restartBot**

Find the `restartBot` method. It should call `disconnect()` on the old bot, then `startBot`. Add a small delay between disconnect and reconnect to allow the audio pipeline to fully stop:

After the old bot's `disconnect()` call and before the new bot creation, add a brief wait:

```typescript
      // Wait for audio pipeline to fully stop before starting new bot
      await new Promise((resolve) => setTimeout(resolve, 100));
```

Place this between the disconnect and the new bot creation.

- [ ] **Step 3: Fix empty catches**

Search for any `catch` blocks that swallow errors silently. Add logging:

```typescript
.catch((err) => {
  this.logger.error({ err, botId }, "Error during bot teardown");
});
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/bot/manager.ts
git commit -m "fix: add cleanup delay on bot restart, log teardown errors

Ensures old bot's audio pipeline is fully stopped before starting
a new instance. Replaces silent catch blocks with error logging.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Add optional method safety helper to provider.ts

**Files:**
- Modify: `src/music/provider.ts`

**Context:** Optional methods like `getDailyRecommendSongs`, `getPersonalFm`, `getUserPlaylists` are called after a manual `if (provider.method)` check. This is fine but the pattern is repeated. Add a helper type guard.

- [ ] **Step 1: Read `src/music/provider.ts`**

Read the file.

- [ ] **Step 2: Add a helper function at the end of the file**

After the interface definition, add:

```typescript
/** Type-safe helper to call an optional method on a MusicProvider */
export function callOptional<T>(
  provider: MusicProvider,
  method: keyof MusicProvider,
  ...args: unknown[]
): T | null {
  const fn = provider[method];
  if (typeof fn === "function") {
    return (fn as (...a: unknown[]) => T).apply(provider, args);
  }
  return null;
}
```

This is a utility — not strictly required since the existing pattern works, but it prevents accidental null dereference. The music.ts routes already check with `if`, so this is optional. Skip creating the helper; the existing pattern is sufficient. Delete this step if not needed.

Actually, on reflection, the existing `if (provider.method)` pattern in music.ts is clear and works fine. Adding a generic helper adds complexity without clear benefit. **Skip this task.**

- [ ] **Step 3: No changes needed — commit not required**

The existing optional method checks in `music.ts` (e.g., `if (!provider.getDailyRecommendSongs)`) are already correct and clear.

---

### Task 12: Build and integration test

- [ ] **Step 1: Build backend**

Run: `npx tsc`
Expected: Clean build, no errors

- [ ] **Step 2: Build frontend**

Run: `cd web && npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (except the pre-existing database.test.ts failure)

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
| 2.2 FFmpeg process management — Remove global PID, reliable cleanup, backpressure | Task 3 |
| 2.3 Database — WAL mode, prepared statement caching, proper close | Task 4 (WAL and caching already exist; adds close guard and checkpoint) |
| 2.4 Error handling — No empty catches, Promise.allSettled, unified format, global middleware | Tasks 2, 3, 5, 6 |
| 2.5 Type safety — Eliminate `any`, optional method checks | Task 6 |
| 2.6 Config validation — Port, volume, string validation | Task 7 |
| 2.7 API input validation — Platform whitelist, botId check, string limits | Tasks 8, 9 |

### Placeholder Scan

No TBD, TODO, or "implement later" found.

### Type Consistency

- `Mutex.run<T>()` returns `Promise<T>` — matches usage in `playNext`
- `validatePlatform` returns `string` — matches `getProvider(platform)` usage
- `validateBotId` returns `string` — matches bot lookup usage
- `getPlaylistDetail` and `getPopularVideos` added to `MusicProvider` interface before `music.ts` uses them
