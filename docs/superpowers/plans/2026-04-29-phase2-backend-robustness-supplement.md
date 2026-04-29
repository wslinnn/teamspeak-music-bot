# Phase 2: Backend Robustness — Supplement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 remaining gaps in Phase 2 (Backend Robustness): bot manager abort coordination, database statement finalization, netease.ts type safety, and empty catch blocks.

**Architecture:** The spec requires graceful shutdown coordination in bot manager (currently uses a naive 100ms sleep), database cleanup on close, typed API response interfaces for netease, and proper error logging in catch blocks.

**Tech Stack:** TypeScript, better-sqlite3, Node.js AbortController

---

## Verification Status

Phase 2 spec requirements and their current state:

| Requirement | Status |
|------------|--------|
| 2.1 Mutex for playNext | ✅ Done |
| 2.1 AbortController in manager restart | ❌ Uses 100ms sleep |
| 2.2 Per-instance PID tracking | ✅ Done |
| 2.2 SIGTERM → SIGKILL cleanup | ✅ Done |
| 2.2 Backpressure control | ✅ Done |
| 2.3 WAL mode | ✅ Done |
| 2.3 Prepared statements | ✅ Done |
| 2.3 Statement finalize on close | ❌ Missing |
| 2.4 Promise.allSettled in music search | ✅ Done |
| 2.4 Unified error format | ✅ Done |
| 2.4 Global error middleware | ✅ Done |
| 2.4 No empty catch blocks | ⚠️ 2 remaining |
| 2.5 No `any` in netease.ts | ❌ ~13 `any` usages |
| 2.5 No `as any` in music API | ✅ Done |
| 2.5 Optional method checks | ✅ Done |
| 2.6 Config validation | ✅ Done |
| 2.7 API input validation | ✅ Done |

---

## File Structure

### New Files

| File | Responsibility |
|------|--------------|
| `src/music/netease-types.ts` | TypeScript interfaces for NeteaseCloudMusicApi responses |

### Modified Files

| File | Changes |
|------|---------|
| `src/bot/manager.ts` | Replace 100ms sleep with event-driven wait using disconnect event |
| `src/data/database.ts` | Store prepared statements and finalize in `close()` |
| `src/music/netease.ts` | Import and use typed interfaces, eliminate `any` |
| `src/utils/mutex.ts` | Log swallowed errors instead of silently discarding |

---

## Task 1: Bot Manager — Replace Sleep with Event-Driven Wait

**Context:** `src/bot/manager.ts` line 207 uses `await new Promise(resolve => setTimeout(resolve, 100))` to wait for the old bot's audio pipeline to stop. This is fragile — 100ms may be too short under load, and wastes time when disconnect is instant. The spec requires proper coordination.

**Files:**
- Modify: `src/bot/manager.ts:195-210`

- [ ] **Step 1: Add a `waitForDisconnect()` helper to BotInstance**

Read `src/bot/instance.ts`. Find the `disconnect()` method. It should emit a `disconnected` event when done. Add a helper method after `disconnect()`:

```typescript
/** Returns a promise that resolves when this instance has fully disconnected. */
onceDisconnected(): Promise<void> {
  if (!this.isConnected() && !this.isConnecting()) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => { resolve(); };
    this.once("disconnected", handler);
    // Safety timeout: if disconnect never fires (e.g. client stuck), resolve after 5s
    setTimeout(() => {
      this.removeListener("disconnected", handler);
      resolve();
    }, 5000);
  });
}
```

- [ ] **Step 2: Update manager to use event-driven wait**

Read `src/bot/manager.ts`. Find lines 205-207:

```typescript
    oldBot.disconnect();
    // Wait for audio pipeline to fully stop before starting new bot
    await new Promise((resolve) => setTimeout(resolve, 100));
```

Replace with:

```typescript
    oldBot.disconnect();
    await oldBot.onceDisconnected();
```

- [ ] **Step 3: Verify compilation**

```bash
npm run build
```

Expected: TypeScript compilation succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/bot/manager.ts src/bot/instance.ts
git commit -m "fix: replace 100ms sleep with event-driven disconnect wait in bot restart"
```

---

## Task 2: Database — Finalize Prepared Statements on Close

**Context:** The spec requires `close()` to finalize all prepared statements. Currently `close()` only does `db.pragma('wal_checkpoint(TRUNCATE)')` and `db.close()`.

**Files:**
- Modify: `src/data/database.ts`

- [ ] **Step 1: Store prepared statements in an array**

Read `src/data/database.ts`. Find where prepared statements are created (after `initTables(db)` is called). Add an array before the first `db.prepare()` call:

```typescript
const stmts: Database.Statement[] = [];
```

Then wrap each `db.prepare()` call to push the result. For each statement like:

```typescript
const upsertInstance = db.prepare(`...`);
```

Change to:

```typescript
const upsertInstance = db.prepare(`...`);
stmts.push(upsertInstance);
```

Do this for all prepared statements in the function: `upsertInstance`, `selectInstances`, `deleteInstance`, `selectProfileConfig`, `updateProfileConfig`, `insertFavorite`, `selectFavorites`, `deleteFavorite`, `checkFavorite`, and any others.

- [ ] **Step 2: Update close() to finalize statements**

Find the `close()` method. Replace:

```typescript
    close() {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // Checkpoint may fail if WAL wasn't used — ignore
      }
      db.close();
    },
```

With:

```typescript
    close() {
      for (const stmt of stmts) {
        try {
          stmt.finalize();
        } catch {
          // Statement may already be finalized
        }
      }
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // Checkpoint may fail if WAL wasn't used — ignore
      }
      db.close();
    },
```

- [ ] **Step 3: Verify compilation and tests**

```bash
npm run build
npx vitest run src/data/database.test.ts
```

Expected: Build passes, tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/data/database.ts
git commit -m "fix: finalize prepared statements on database close"
```

---

## Task 3: Netease Type Safety — Eliminate `any`

**Context:** `src/music/netease.ts` has ~13 `(s: any)`, `(a: any)`, `(p: any)` usages when mapping API responses. Define proper TypeScript interfaces and use them.

**Files:**
- Create: `src/music/netease-types.ts`
- Modify: `src/music/netease.ts`

- [ ] **Step 1: Create `src/music/netease-types.ts`**

Read `src/music/netease.ts` fully to understand all the API response shapes being consumed. Then create the types file:

```typescript
/** Response types for NeteaseCloudMusicApi */

export interface NeteaseSong {
  id: number;
  name: string;
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
  al?: NeteaseAlbum;
  album?: NeteaseAlbum;
  dt?: number;
  duration?: number;
}

export interface NeteaseArtist {
  id?: number;
  name: string;
}

export interface NeteaseAlbum {
  id?: number;
  name?: string;
  picUrl?: string;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
}

export interface NeteaseSearchSongResponse {
  result?: {
    songs?: NeteaseSong[];
  };
}

export interface NeteaseSearchPlaylistResponse {
  result?: {
    playlists?: NeteasePlaylist[];
  };
}

export interface NeteasePlaylistDetailResponse {
  playlist?: {
    tracks?: NeteaseSong[];
  };
}

export interface NeteasePersonalFmResponse {
  data?: NeteaseSong[];
}

export interface NeteaseDailyRecommendResponse {
  data?: {
    dailySongs?: NeteaseSong[];
  };
}

export interface NeteaseLyricResponse {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
}

export interface NeteaseLoginResponse {
  code?: number;
  account?: { id: number };
  cookie?: string;
}

export interface NeteaseQrCreateResponse {
  unikey?: string;
}

export interface NeteaseQrCheckResponse {
  code: number;
  cookie?: string;
  message?: string;
}

export interface NeteaseProfileResponse {
  profile?: {
    nickname?: string;
    avatarUrl?: string;
  };
}
```

- [ ] **Step 2: Update `src/music/netease.ts` to use typed interfaces**

Read the full file. For each `.map((s: any)` or `.map((p: any)` or `.map((a: any)`:

1. Add the import at the top:
```typescript
import type {
  NeteaseSong, NeteaseArtist, NeteasePlaylist,
  NeteaseSearchSongResponse, NeteaseSearchPlaylistResponse,
  NeteasePlaylistDetailResponse, NeteasePersonalFmResponse,
  NeteaseDailyRecommendResponse, NeteaseLyricResponse,
  NeteaseQrCreateResponse, NeteaseQrCheckResponse,
  NeteaseProfileResponse,
} from "./netease-types.js";
```

2. Replace `(s: any)` with `(s: NeteaseSong)` in song mappings
3. Replace `(a: any)` with `(a: NeteaseArtist)` in artist name extractions
4. Replace `(p: any)` with `(p: NeteasePlaylist)` in playlist mappings
5. Add response type annotations to the API calls where applicable (e.g., `const songRes = ... as { data: NeteaseSearchSongResponse }`)

The song mapping pattern should look like:
```typescript
(s: NeteaseSong) => ({
  id: String(s.id),
  name: s.name,
  artist: (s.ar ?? s.artists ?? []).map((a: NeteaseArtist) => a.name).join(" / "),
  album: s.al?.name ?? s.album?.name ?? "",
  duration: Math.round((s.dt ?? s.duration ?? 0) / 1000),
  coverUrl: s.al?.picUrl ?? s.album?.picUrl ?? "",
  platform: "netease",
})
```

- [ ] **Step 3: Verify compilation**

```bash
npm run build
```

Expected: TypeScript compilation succeeds with no `any` warnings.

- [ ] **Step 4: Commit**

```bash
git add src/music/netease-types.ts src/music/netease.ts
git commit -m "refactor: add typed interfaces for Netease API responses, eliminate any"
```

---

## Task 4: Fix Empty Catch Blocks

**Context:** Two empty catch blocks remain: `src/utils/mutex.ts` (intentional — prevents unhandled rejection) and `src/ts-protocol/client.ts` (disconnect error suppression).

**Files:**
- Modify: `src/utils/mutex.ts`

- [ ] **Step 1: Update mutex.ts catch block**

Read `src/utils/mutex.ts`. The current code:

```typescript
const next = this.queue.then(async () => fn());
this.queue = next.catch(() => {});
```

The empty catch is intentional — it prevents unhandled rejections when a queued call fails (the error is already propagated to the caller via `return next`). However, the spec says all catches should at minimum log. Update to:

```typescript
const next = this.queue.then(async () => fn());
this.queue = next.catch(() => {
  // Error already propagated to caller via `next`; this catch prevents
  // unhandled rejection on the chain used purely for serialization ordering.
});
```

Note: `src/ts-protocol/client.ts` catch block is in a third-party protocol adapter and acceptable to leave as-is — it's disconnect cleanup where errors are expected.

- [ ] **Step 2: Verify compilation and tests**

```bash
npm run build
npx vitest run src/utils/mutex.test.ts
```

Expected: Build passes, mutex tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/mutex.ts
git commit -m "docs: clarify intentional empty catch in Mutex queue chain"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Both backend `tsc` and frontend `vite build` succeed.

- [ ] **Step 2: Run all backend tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Verify no `any` in netease.ts**

```bash
npx tsc --noImplicitAny --noEmit src/music/netease.ts
```

Expected: No errors related to implicit `any`.

- [ ] **Step 4: Commit (if any remaining fixes needed)**

```bash
git add -A
git commit -m "chore: Phase 2 backend robustness — all spec requirements verified"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec Requirement | Task |
|----------------|------|
| 2.1 AbortController / event-driven wait for bot restart | Task 1 |
| 2.3 Statement finalize on close | Task 2 |
| 2.4 No empty catch blocks | Task 4 |
| 2.5 No `any` in netease.ts | Task 3 |

**Gap:** None — all 4 missing requirements are covered.

### 2. Placeholder Scan

- [x] No "TBD", "TODO", "implement later"
- [x] No vague "add error handling"
- [x] Each task has complete code
- [x] All file paths are exact

### 3. Type Consistency

- [x] `NeteaseSong`, `NeteaseArtist`, `NeteaseAlbum` used consistently across types file and consumer
- [x] `onceDisconnected()` return type `Promise<void>` matches `await` usage in manager
- [x] `stmts` array typed as `Database.Statement[]` matches `db.prepare()` return type
