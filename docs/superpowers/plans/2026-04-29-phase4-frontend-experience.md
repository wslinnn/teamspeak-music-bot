# Phase 4: Frontend Experience Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade UI experience with card-based search, drag-and-drop queue, responsive mobile layout, and polished animations — all built on top of Phase 3's Tailwind + component library foundation.

**Architecture:** Search switches from list rows to a card grid with platform filtering. Queue gains SortableJS-based drag reordering backed by a new backend API. Navbar and Player adopt mobile-first responsive breakpoints. Staggered enter animations use Vue `<TransitionGroup>` with CSS delay offsets.

**Tech Stack:** Vue 3, Tailwind CSS v4, Vite, vuedraggable@4 (SortableJS wrapper), Pinia

---

## File Structure

### New Files

| File | Responsibility |
|------|--------------|
| `web/src/components/SongGridCard.vue` | Card-layout song item: cover, name, artist, platform badge, hover play button |
| `web/src/components/PlayingIndicator.vue` | Three-bar CSS animation indicating playback |

### Modified Files

| File | Changes |
|------|---------|
| `src/audio/queue.ts` | Add `reorder(fromIndex, toIndex)` method |
| `src/web/api/player.ts` | Add `POST /:botId/queue/reorder` endpoint |
| `src/bot/instance.ts` | Add `!reorder <from> <to>` command handler |
| `web/src/stores/player.ts` | Add `reorderQueue(fromIndex, toIndex)` action |
| `web/package.json` | Add `vuedraggable` dependency |
| `web/src/views/Search.vue` | Card grid layout, platform filter tabs, hover effects |
| `web/src/components/Player.vue` | Playing indicator, rAF lifecycle optimization, mobile simplification |
| `web/src/components/Queue.vue` | Drag-and-drop reordering with `vuedraggable` |
| `web/src/components/Navbar.vue` | Hamburger menu for mobile, responsive breakpoints |
| `web/src/components/SongCard.vue` | Active track highlight enhancement |
| `web/src/styles/index.css` | Stagger animation keyframes, mobile-safe utility adjustments |

---

## Prerequisite Check

Before starting, confirm:

```bash
cd web && npm run build
```

The production build succeeds. If it fails, fix build errors before proceeding.

---

## Task 1: Backend Queue Reorder API

**Files:**
- Modify: `src/audio/queue.ts`
- Modify: `src/web/api/player.ts`
- Modify: `src/bot/instance.ts`
- Modify: `web/src/stores/player.ts`

Queue drag-and-drop requires a backend API to persist reordering. The `PlayQueue` class currently has no method to move items.

- [ ] **Step 1: Add `reorder` method to `src/audio/queue.ts`**

Insert the following method into the `PlayQueue` class, after the `remove` method (around line 52):

```ts
  reorder(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex < 0 ||
      fromIndex >= this.songs.length ||
      toIndex < 0 ||
      toIndex >= this.songs.length ||
      fromIndex === toIndex
    ) {
      return false;
    }

    const [moved] = this.songs.splice(fromIndex, 1);
    this.songs.splice(toIndex, 0, moved);

    // Adjust currentIndex if it was affected by the splice
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }

    // Rebuild playedIndices to reflect new positions
    const newPlayed = new Set<number>();
    for (const idx of this.playedIndices) {
      if (idx === fromIndex) {
        newPlayed.add(toIndex);
      } else if (fromIndex < idx && idx <= toIndex) {
        newPlayed.add(idx - 1);
      } else if (toIndex <= idx && idx < fromIndex) {
        newPlayed.add(idx + 1);
      } else {
        newPlayed.add(idx);
      }
    }
    this.playedIndices = newPlayed;

    return true;
  }
```

- [ ] **Step 2: Add unit test for `reorder` in `src/audio/queue.test.ts`**

Open `src/audio/queue.test.ts` and append a new `describe` block at the end of the file:

```ts
describe("PlayQueue reorder", () => {
  it("moves song from front to back", () => {
    const queue = new PlayQueue();
    queue.add({ id: "a", name: "A", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    queue.add({ id: "b", name: "B", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    queue.add({ id: "c", name: "C", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    queue.play();

    const ok = queue.reorder(0, 2);
    expect(ok).toBe(true);
    expect(queue.list().map((s) => s.name)).toEqual(["B", "C", "A"]);
    expect(queue.getCurrentIndex()).toBe(2); // previously-playing A is now at index 2
  });

  it("moves song from back to front", () => {
    const queue = new PlayQueue();
    queue.add({ id: "a", name: "A", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    queue.add({ id: "b", name: "B", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    queue.add({ id: "c", name: "C", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    queue.playAt(1);

    const ok = queue.reorder(2, 0);
    expect(ok).toBe(true);
    expect(queue.list().map((s) => s.name)).toEqual(["C", "A", "B"]);
    expect(queue.getCurrentIndex()).toBe(2); // previously-playing B is now at index 2
  });

  it("rejects out-of-range indices", () => {
    const queue = new PlayQueue();
    queue.add({ id: "a", name: "A", artist: "", album: "", coverUrl: "", duration: 1, platform: "netease" });
    expect(queue.reorder(0, 5)).toBe(false);
    expect(queue.reorder(-1, 0)).toBe(false);
  });
});
```

- [ ] **Step 3: Run queue tests**

```bash
npm test -- src/audio/queue.test.ts
```

Expected: All tests pass, including the 3 new reorder tests.

- [ ] **Step 4: Add API endpoint in `src/web/api/player.ts`**

Insert the following route handler before the `return router;` line (around line 405):

```ts
  router.post("/:botId/queue/reorder", async (req, res) => {
    try {
      const bot = (req as any).bot;
      const { fromIndex, toIndex } = req.body;
      if (
        typeof fromIndex !== "number" ||
        typeof toIndex !== "number" ||
        !Number.isFinite(fromIndex) ||
        !Number.isFinite(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0
      ) {
        res.status(400).json({ error: "fromIndex and toIndex must be non-negative numbers" });
        return;
      }
      const queue = bot.getQueueManager();
      const ok = queue.reorder(fromIndex, toIndex);
      if (!ok) {
        res.status(400).json({ error: "Invalid reorder indices" });
        return;
      }
      res.json({ message: "Queue reordered", queue: queue.list() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
```

- [ ] **Step 5: Add `!reorder` bot command in `src/bot/instance.ts`**

Find the `executeCommand` switch statement and add a new case after `case "remove":` (around line 292):

```ts
      case "reorder":
        return this.cmdReorder(cmd);
```

Then add the command handler method near `cmdRemove` (around line 507):

```ts
  private cmdReorder(cmd: ParsedCommand): string {
    if (!cmd.args) return "Usage: !reorder <from> <to>";
    const parts = cmd.args.trim().split(/\s+/);
    if (parts.length !== 2) return "Usage: !reorder <from> <to>";
    const fromIndex = parseInt(parts[0], 10) - 1; // 1-based user input
    const toIndex = parseInt(parts[1], 10) - 1;
    if (isNaN(fromIndex) || isNaN(toIndex)) return "Usage: !reorder <from> <to>";
    const ok = this.queue.reorder(fromIndex, toIndex);
    if (!ok) return "Invalid reorder positions";
    return `Reordered: position ${fromIndex + 1} → ${toIndex + 1}`;
  }
```

Also add `!reorder` to the help text in `cmdHelp` (around line 631):

```ts
      `${p}reorder <from> <to> — Move queue item`,
```

- [ ] **Step 6: Add `reorderQueue` action to `web/src/stores/player.ts`**

Insert the following action into the store actions block (after `fetchQueueForBot`, around line 227):

```ts
    async reorderQueue(fromIndex: number, toIndex: number) {
      if (!this.activeBotId) return;
      try {
        await http.post(`/api/player/${this.activeBotId}/queue/reorder`, { fromIndex, toIndex });
        await this.fetchQueue();
      } catch (err) {
        console.error('Queue reorder failed:', err);
      }
    },
```

- [ ] **Step 7: Verify backend compiles and tests pass**

```bash
npm run build && npm test -- src/audio/queue.test.ts
```

Expected: Build succeeds, queue tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/audio/queue.ts src/audio/queue.test.ts src/web/api/player.ts src/bot/instance.ts web/src/stores/player.ts
git commit -m "feat(backend): add queue reorder API and !reorder command"
```

---

## Task 2: Search Page Redesign

**Files:**
- Create: `web/src/components/SongGridCard.vue`
- Modify: `web/src/views/Search.vue`

- [ ] **Step 1: Create `web/src/components/SongGridCard.vue`**

```vue
<template>
  <div
    class="group relative cursor-pointer overflow-hidden rounded-[var(--radius-md)] bg-surface-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
    @click="$emit('play')"
  >
    <!-- Cover -->
    <div class="relative aspect-square overflow-hidden">
      <CoverArt :url="song.coverUrl" :size="200" :radius="0" />
      <!-- Hover play overlay -->
      <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
          <Icon icon="mdi:play" class="text-2xl" />
        </div>
      </div>
      <!-- Platform badge -->
      <div
        class="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold"
        :class="platformBadgeClass"
      >
        {{ platformLabel }}
      </div>
    </div>

    <!-- Info -->
    <div class="p-3">
      <div class="truncate text-sm font-medium">{{ song.name }}</div>
      <div class="mt-0.5 truncate text-xs text-foreground-muted">{{ song.artist }}</div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-xs text-foreground-subtle">{{ formatDuration(song.duration) }}</span>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-full text-foreground-muted opacity-0 transition-all duration-200 hover:bg-interactive-hover hover:text-primary group-hover:opacity-100"
          @click.stop="$emit('add')"
          title="添加到队列"
        >
          <Icon icon="mdi:playlist-plus" class="text-lg" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { Song } from '../stores/player.js';
import CoverArt from './CoverArt.vue';

const props = defineProps<{ song: Song }>();
defineEmits<{ play: []; add: [] }>();

const platformLabel = computed(() => {
  switch (props.song.platform) {
    case 'bilibili': return 'B站';
    case 'qq': return 'QQ';
    case 'youtube': return 'YouTube';
    default: return '网易云';
  }
});

const platformBadgeClass = computed(() => {
  switch (props.song.platform) {
    case 'bilibili': return 'bg-[#00a1d6]/90 text-white';
    case 'qq': return 'bg-[#12b76a]/90 text-white';
    case 'youtube': return 'bg-[#ff0000]/90 text-white';
    default: return 'bg-[#e81123]/90 text-white';
  }
});

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>
```

- [ ] **Step 2: Rewrite `web/src/views/Search.vue`**

Replace the entire file:

```vue
<template>
  <div class="search-page">
    <!-- Back button -->
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <!-- Search input -->
    <div class="mb-4">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          ref="searchInput"
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="搜索歌曲、歌手、专辑..."
          @keyup.enter="doSearch"
        />
      </div>
    </div>

    <!-- Platform filter tabs -->
    <div class="mb-6 flex flex-wrap gap-2">
      <button
        v-for="tab in platformTabs"
        :key="tab.key"
        class="rounded-full px-4 py-1.5 text-sm font-medium transition-all"
        :class="activePlatform === tab.key
          ? 'bg-primary text-white'
          : 'bg-surface-card text-foreground-muted hover:bg-interactive-hover hover:text-foreground'"
        @click="activePlatform = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <SkeletonLoader v-for="n in 10" :key="n" height="220px" border-radius="10px" />
    </div>

    <!-- Results grid -->
    <div v-else-if="results.length > 0">
      <div class="mb-3 text-sm text-foreground-subtle">
        找到 {{ results.length }} 首歌曲
      </div>
      <TransitionGroup
        tag="div"
        name="stagger"
        class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        <SongGridCard
          v-for="(song, i) in results"
          :key="`${song.platform}-${song.id}`"
          :song="song"
          :style="{ animationDelay: `${Math.min(i * 40, 400)}ms` }"
          @play="store.playSong(song)"
          @add="store.addSong(song)"
        />
      </TransitionGroup>
    </div>

    <!-- Error -->
    <EmptyState
      v-else-if="errorMsg"
      :message="errorMsg"
      icon="mdi:alert-circle-outline"
    />

    <!-- Empty -->
    <EmptyState
      v-else-if="searched"
      message="未找到相关结果"
      icon="mdi:music-note-off"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type Song } from '../stores/player';
import SongGridCard from '../components/SongGridCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = usePlayerStore();
const route = useRoute();

const searchInput = ref<HTMLInputElement | null>(null);
const query = ref((route.query.q as string) || '');
const results = ref<Song[]>([]);
const loading = ref(false);
const searched = ref(false);
const errorMsg = ref('');

const platformTabs = [
  { key: 'all', label: '全部' },
  { key: 'netease', label: '网易云' },
  { key: 'qq', label: 'QQ' },
  { key: 'bilibili', label: 'B站' },
  { key: 'youtube', label: 'YouTube' },
];
const activePlatform = ref('all');

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  errorMsg.value = '';
  try {
    let res;
    if (activePlatform.value === 'all') {
      res = await http.get('/api/music/search/all', { params: { q: query.value } });
    } else {
      res = await http.get('/api/music/search', { params: { q: query.value, platform: activePlatform.value } });
    }
    results.value = res.data.songs ?? [];
  } catch (err: unknown) {
    console.error('Search failed:', err);
    errorMsg.value = '搜索失败，请稍后重试';
    results.value = [];
  } finally {
    loading.value = false;
  }
}

// Re-search when platform filter changes and we already have a query
watch(activePlatform, () => {
  if (query.value.trim() && searched.value) {
    doSearch();
  }
});

onMounted(() => {
  searchInput.value?.focus();
  if (query.value) doSearch();
});
</script>
```

- [ ] **Step 3: Add stagger styles to `web/src/styles/index.css`**

Append to the end of `web/src/styles/index.css`:

```css
/* Staggered list enter animation */
.stagger-enter-active {
  transition: all 0.3s ease;
}
.stagger-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
```

- [ ] **Step 4: Verify Search page renders**

```bash
cd web && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SongGridCard.vue web/src/views/Search.vue web/src/styles/index.css
git commit -m "feat(frontend): redesign Search.vue with card grid and platform filters"
```

---

## Task 3: Player Enhancements

**Files:**
- Create: `web/src/components/PlayingIndicator.vue`
- Modify: `web/src/components/Player.vue`

- [ ] **Step 1: Create `web/src/components/PlayingIndicator.vue`**

```vue
<template>
  <div class="flex items-end gap-[3px] h-4">
    <div
      class="w-[3px] rounded-sm bg-primary"
      :class="{ 'animate-bar1': isPlaying, 'h-1': !isPlaying }"
      :style="isPlaying ? {} : { height: '4px' }"
    />
    <div
      class="w-[3px] rounded-sm bg-primary"
      :class="{ 'animate-bar2': isPlaying, 'h-1': !isPlaying }"
      :style="isPlaying ? {} : { height: '4px' }"
    />
    <div
      class="w-[3px] rounded-sm bg-primary"
      :class="{ 'animate-bar3': isPlaying, 'h-1': !isPlaying }"
      :style="isPlaying ? {} : { height: '4px' }"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ isPlaying: boolean }>();
</script>

<style scoped>
@keyframes bar-bounce {
  0%, 100% { height: 4px; }
  50% { height: 16px; }
}

.animate-bar1 {
  animation: bar-bounce 0.8s ease-in-out infinite;
}
.animate-bar2 {
  animation: bar-bounce 0.8s ease-in-out 0.15s infinite;
}
.animate-bar3 {
  animation: bar-bounce 0.8s ease-in-out 0.3s infinite;
}
</style>
```

- [ ] **Step 2: Add playing-indicator keyframes to `web/src/styles/index.css`**

Append to the end of the file (after the stagger styles):

```css
@keyframes bar-bounce {
  0%, 100% { transform: scaleY(0.25); }
  50% { transform: scaleY(1); }
}
```

- [ ] **Step 3: Modify `web/src/components/Player.vue`**

Make the following targeted changes:

**3a. Add import for PlayingIndicator near the top of `<script setup>`:**

After `import Queue from './Queue.vue';` (line 83), add:

```ts
import PlayingIndicator from './PlayingIndicator.vue';
```

**3b. Replace the `player-left` section in `<template>` to show the playing indicator:**

Replace lines 27–36:

```vue
      <div class="player-left" @click="toggleLyrics">
        <CoverArt :url="currentSong.coverUrl" :size="40" />
        <div class="song-info">
          <div class="song-name">
            <PlayingIndicator v-if="store.isPlaying && !store.isPaused" :is-playing="true" class="mr-2 inline-flex" />
            {{ currentSong.name }}
          </div>
          <div class="song-artist">
            <span v-if="showBotBadge" class="bot-badge">{{ activeBot?.name }}</span>
            {{ currentSong.artist }}
          </div>
        </div>
      </div>
```

**3c. Optimize rAF lifecycle — only run when playing:**

Replace the `updateProgress` function (lines 123–133) with:

```ts
function updateProgress() {
  currentElapsed.value = store.elapsed;
  const duration = currentSong.value?.duration ?? 0;
  progressPercent.value = duration > 0
    ? Math.min((currentElapsed.value / duration) * 100, 100)
    : 0;

  // Only schedule next frame if still playing
  if (store.isPlaying) {
    rafId = requestAnimationFrame(updateProgress);
  } else {
    rafId = null;
  }
}
```

Add a watcher to restart rAF when playback resumes. After the `onUnmounted` block (line 162), add:

```ts
// Restart/stop rAF when play state changes
watch(() => store.isPlaying, (playing) => {
  if (playing && rafId === null) {
    rafId = requestAnimationFrame(updateProgress);
  }
  // When pausing, the next updateProgress tick will stop itself
});
```

Also add `watch` to the imports from `vue` (line 78):

```ts
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
```

**3d. Add mobile-responsive classes to the template:**

Replace the entire `<template>` section (lines 1–74) with:

```vue
<template>
  <div class="player-wrapper" v-if="currentSong">
    <Queue :open="showQueue" @close="showQueue = false" />

    <div class="player-bar frosted-glass">
      <!-- Progress bar -->
      <div
        class="progress-bar-container"
        ref="progressBarRef"
        @click="onProgressClick"
        @mousemove="onProgressHover"
        @mouseleave="progressTooltipVisible = false"
      >
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }" />
          <div class="progress-bar-thumb" :style="{ left: progressPercent + '%' }" />
        </div>
        <div
          v-if="progressTooltipVisible"
          class="progress-tooltip"
          :style="{ left: progressTooltipX + 'px' }"
        >
          {{ progressTooltipTime }}
        </div>
      </div>

      <div class="player-left" @click="toggleLyrics">
        <CoverArt :url="currentSong.coverUrl" :size="40" />
        <div class="song-info">
          <div class="song-name">
            <PlayingIndicator v-if="store.isPlaying && !store.isPaused" :is-playing="true" class="mr-2 inline-flex" />
            {{ currentSong.name }}
          </div>
          <div class="song-artist">
            <span v-if="showBotBadge" class="bot-badge">{{ activeBot?.name }}</span>
            {{ currentSong.artist }}
          </div>
        </div>
      </div>

      <div class="player-center">
        <span class="time-display time-current hidden sm:inline">{{ formatTime(currentElapsed) }}</span>
        <button class="control-btn" @click="store.prev()">
          <Icon icon="mdi:skip-previous" />
        </button>
        <button class="play-btn" @click="togglePlay">
          <Icon :icon="store.isPlaying ? 'mdi:pause' : 'mdi:play'" />
        </button>
        <button class="control-btn" @click="store.next()">
          <Icon icon="mdi:skip-next" />
        </button>
        <button class="control-btn mode-btn hidden sm:flex" @click="cycleMode" :title="modeLabel">
          <Icon :icon="modeIcon" />
          <span class="mode-label">{{ modeLabel }}</span>
        </button>
        <span class="time-display time-total hidden sm:inline">{{ formatTime(currentSong?.duration ?? 0) }}</span>
      </div>

      <div class="player-right">
        <Icon icon="mdi:volume-high" class="volume-icon hidden sm:block" />
        <input
          type="range"
          min="0"
          max="100"
          :value="activeBot?.volume ?? 75"
          @change="onVolumeChange"
          class="volume-slider hidden sm:block"
        />
        <button class="control-btn" :class="{ active: showQueue }" @click="showQueue = !showQueue">
          <Icon icon="mdi:playlist-music" />
        </button>
        <button class="control-btn lyrics-btn hidden sm:block" :class="{ active: route.path === '/lyrics' }" @click="toggleLyrics">
          <Icon icon="mdi:microphone" />
        </button>
      </div>
    </div>
  </div>
</template>
```

The key changes are:
- Added `<PlayingIndicator />` next to the song name
- Added `hidden sm:inline` / `hidden sm:block` / `hidden sm:flex` to hide secondary controls on mobile
- rAF only runs while `store.isPlaying` is true

- [ ] **Step 4: Verify build**

```bash
cd web && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PlayingIndicator.vue web/src/components/Player.vue web/src/styles/index.css
git commit -m "feat(frontend): Player enhancements — playing indicator, rAF optimization, mobile simplification"
```

---

## Task 4: Queue Drag-and-Drop Sorting

**Files:**
- Modify: `web/src/components/Queue.vue`
- Modify: `web/package.json`

- [ ] **Step 1: Install `vuedraggable`**

```bash
cd web && npm install vuedraggable@4
```

- [ ] **Step 2: Rewrite `web/src/components/Queue.vue`**

Replace the entire file:

```vue
<template>
  <div class="queue-panel" :class="{ open }">
    <div class="queue-header">
      <h3 class="queue-title">播放队列</h3>
      <span class="queue-count">{{ botQueue.length }} 首</span>
      <button class="close-btn" @click="$emit('close')">
        <Icon icon="mdi:close" />
      </button>
    </div>

    <div v-if="botQueue.length === 0" class="queue-empty">
      队列为空
    </div>

    <div v-else class="queue-list">
      <draggable
        :model-value="botQueue"
        item-key="id"
        handle=".drag-handle"
        ghost-class="queue-item-ghost"
        drag-class="queue-item-drag"
        @end="onDragEnd"
      >
        <template #item="{ element: song, index: i }">
          <div
            class="queue-item"
            :class="{ active: store.currentSong?.id === song.id }"
            @dblclick="playAtIndex(i)"
          >
            <span class="drag-handle cursor-grab text-foreground-subtle opacity-0 transition-opacity hover:opacity-100">
              <Icon icon="mdi:drag-vertical" />
            </span>
            <CoverArt :url="song.coverUrl" :size="32" :radius="4" />
            <div class="queue-song-info">
              <div class="queue-song-name">{{ song.name }}</div>
              <div class="queue-song-artist">{{ song.artist }}</div>
            </div>
            <button class="remove-btn" @click="removeSong(i)" title="移除">
              <Icon icon="mdi:close" />
            </button>
          </div>
        </template>
      </draggable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, computed } from 'vue';
import { Icon } from '@iconify/vue';
import draggable from 'vuedraggable';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import CoverArt from './CoverArt.vue';

const props = defineProps<{
  open: boolean;
}>();

defineEmits<{
  close: [];
}>();

const store = usePlayerStore();
const botQueue = computed(() => store.queue);

// Fetch queue when panel opens
watch(() => props.open, (isOpen) => {
  if (isOpen) store.fetchQueue();
});

async function playAtIndex(index: number) {
  await store.playAtIndex(index);
  await store.fetchQueue();
}

async function removeSong(index: number) {
  if (!store.activeBotId) return;
  try {
    await http.delete(`/api/player/${store.activeBotId}/queue/${index + 1}`);
    await store.fetchQueue();
  } catch {
    // Ignore
  }
}

async function onDragEnd(evt: { oldIndex: number; newIndex: number }) {
  if (evt.oldIndex === evt.newIndex) return;
  await store.reorderQueue(evt.oldIndex, evt.newIndex);
}
</script>

<style lang="scss" scoped>
.queue-panel {
  position: fixed;
  top: var(--navbar-height);
  right: -360px;
  bottom: var(--player-height);
  width: 360px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  z-index: 90;
  transition: right var(--transition-normal);
  display: flex;
  flex-direction: column;

  &.open {
    right: 0;
  }
}

.queue-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.queue-title {
  font-size: 16px;
  font-weight: 700;
}

.queue-count {
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.close-btn {
  margin-left: auto;
  font-size: 18px;
  opacity: 0.6;
  transition: opacity var(--transition-fast);
  &:hover { opacity: 1; }
}

.queue-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}

.queue-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--hover-bg);
    .remove-btn { opacity: 1; }
    .drag-handle { opacity: 0.5 !important; }
  }

  &.active {
    background: rgba(51, 94, 234, 0.1);
  }
}

.queue-item-ghost {
  opacity: 0.5;
  background: var(--hover-bg);
}

.queue-item-drag {
  opacity: 0.9;
  background: var(--bg-card);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.queue-song-info {
  flex: 1;
  min-width: 0;
}

.queue-song-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-song-artist {
  font-size: 11px;
  color: var(--text-secondary);
}

.remove-btn {
  font-size: 14px;
  opacity: 0;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: opacity var(--transition-fast);
  color: var(--text-tertiary);
  &:hover { color: var(--text-primary); }
}

.drag-handle {
  font-size: 16px;
  padding: 2px;
  flex-shrink: 0;
}
</style>
```

- [ ] **Step 3: Verify build**

```bash
cd web && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/components/Queue.vue
git commit -m "feat(frontend): add queue drag-and-drop reordering with vuedraggable"
```

---

## Task 5: Responsive Navbar

**Files:**
- Modify: `web/src/components/Navbar.vue`

- [ ] **Step 1: Rewrite `web/src/components/Navbar.vue` with mobile hamburger**

Replace the `<template>` section (lines 1–81) with:

```vue
<template>
  <nav class="navbar frosted-glass">
    <RouterLink to="/" class="logo">TSMusicBot</RouterLink>

    <!-- Desktop nav links -->
    <div class="nav-links hidden md:flex">
      <RouterLink to="/" class="nav-link" active-class="active">发现</RouterLink>
      <RouterLink to="/search" class="nav-link" active-class="active">搜索</RouterLink>
      <RouterLink to="/history" class="nav-link" active-class="active">播放历史</RouterLink>
    </div>

    <!-- Mobile hamburger -->
    <button class="hamburger md:hidden" @click="mobileMenuOpen = !mobileMenuOpen">
      <Icon :icon="mobileMenuOpen ? 'mdi:close' : 'mdi:menu'" class="text-2xl" />
    </button>

    <div class="nav-right">
      <!-- Bot selector (always shown when at least one bot exists) -->
      <div v-if="store.bots.length > 0" class="bot-selector" ref="selectorRef">
        <button class="bot-selector-btn" @click="dropdownOpen = !dropdownOpen">
          <span class="bot-dot" :class="{ online: activeBot?.connected }" />
          <span class="bot-selector-name hidden sm:inline">{{ activeBot?.name ?? '选择机器人' }}</span>
          <span v-if="activeBot?.playing && !activeBot?.paused" class="bot-state-mini playing">▶</span>
          <span v-else-if="activeBot?.paused" class="bot-state-mini paused">⏸</span>
          <Icon icon="mdi:chevron-down" class="bot-chevron" :class="{ rotated: dropdownOpen }" />
        </button>
        <div v-if="dropdownOpen" class="bot-dropdown">
          <div
            v-for="bot in store.bots"
            :key="bot.id"
            class="bot-dropdown-row"
          >
            <button
              class="bot-dropdown-item"
              :class="{ active: bot.id === store.activeBotId }"
              @click="selectBot(bot.id)"
            >
              <span class="bot-dot" :class="{ online: bot.connected }" />
              <span class="bot-dropdown-name">{{ bot.name }}</span>
              <span v-if="bot.playing && !bot.paused" class="bot-playing-badge">播放中</span>
              <span v-else-if="bot.paused" class="bot-paused-badge">已暂停</span>
              <span v-else-if="bot.connected" class="bot-idle-badge">空闲</span>
              <span v-else class="bot-offline-badge">离线</span>
            </button>
            <button
              class="bot-power-btn"
              :class="{ online: bot.connected }"
              :title="bot.connected ? `停止 ${bot.name}` : `启动 ${bot.name}`"
              :disabled="togglingBots[bot.id]"
              @click.stop="togglePower(bot)"
            >
              <Icon :icon="bot.connected ? 'mdi:power' : 'mdi:power-off'" />
            </button>
            <button class="bot-link-btn" :title="`复制 ${bot.name} 的专属链接`" @click.stop="copyBotLink(bot.id)">
              <Icon icon="mdi:link-variant" />
            </button>
          </div>
          <div class="bot-dropdown-divider" />
          <div class="bot-dropdown-hint">点击切换 · 🔗 复制专属链接</div>
        </div>
      </div>

      <RouterLink to="/settings" class="settings-btn">
        <Icon icon="mdi:cog" />
      </RouterLink>
    </div>
  </nav>

  <!-- Mobile menu overlay -->
  <Transition name="mobile-menu">
    <div v-if="mobileMenuOpen" class="mobile-menu-overlay md:hidden" @click="mobileMenuOpen = false">
      <div class="mobile-menu" @click.stop>
        <RouterLink to="/" class="mobile-nav-link" active-class="active" @click="mobileMenuOpen = false">
          <Icon icon="mdi:home" class="mr-3" /> 发现
        </RouterLink>
        <RouterLink to="/search" class="mobile-nav-link" active-class="active" @click="mobileMenuOpen = false">
          <Icon icon="mdi:magnify" class="mr-3" /> 搜索
        </RouterLink>
        <RouterLink to="/history" class="mobile-nav-link" active-class="active" @click="mobileMenuOpen = false">
          <Icon icon="mdi:history" class="mr-3" /> 播放历史
        </RouterLink>
        <RouterLink to="/settings" class="mobile-nav-link" active-class="active" @click="mobileMenuOpen = false">
          <Icon icon="mdi:cog" class="mr-3" /> 设置
        </RouterLink>
      </div>
    </div>
  </Transition>

  <div v-if="linkDialog.open" class="link-dialog-backdrop" @click="closeLinkDialog">
    <div class="link-dialog" @click.stop>
      <div class="link-dialog-title">{{ linkDialog.name }} 的专属链接</div>
      <div class="link-dialog-hint">选中文本并按 Ctrl/Cmd+C 复制，或点击下方按钮</div>
      <input
        ref="linkInputRef"
        class="link-dialog-input"
        :value="linkDialog.url"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
      />
      <div class="link-dialog-actions">
        <button class="link-dialog-btn primary" @click="copyLinkFromDialog">
          {{ linkDialog.copied ? '已复制' : '复制链接' }}
        </button>
        <button class="link-dialog-btn" @click="closeLinkDialog">关闭</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Add `mobileMenuOpen` ref to `<script setup>`**

After `const dropdownOpen = ref(false);` (line 91), add:

```ts
const mobileMenuOpen = ref(false);
```

- [ ] **Step 3: Add mobile menu styles to the `<style>` block**

Append to the end of the `<style lang="scss" scoped>` block:

```scss
.hamburger {
  margin-left: auto;
  padding: 8px;
  font-size: 20px;
  opacity: 0.7;
  transition: opacity var(--transition-fast);
  &:hover { opacity: 1; }
}

.mobile-menu-overlay {
  position: fixed;
  inset: var(--navbar-height) 0 0 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 99;
  backdrop-filter: blur(4px);
}

.mobile-menu {
  position: absolute;
  top: 0;
  right: 0;
  width: 240px;
  max-width: 80vw;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mobile-nav-link {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 500;
  opacity: 0.7;
  transition: background var(--transition-fast), opacity var(--transition-fast);

  &:hover { opacity: 0.9; background: var(--hover-bg); }
  &.active { opacity: 1; color: var(--color-primary); background: rgba(51, 94, 234, 0.1); }
}

.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: opacity 0.2s ease;
}
.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
}
```

- [ ] **Step 4: Verify build**

```bash
cd web && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Navbar.vue
git commit -m "feat(frontend): responsive Navbar with mobile hamburger menu"
```

---

## Task 6: Responsive Search and SongCard

**Files:**
- Modify: `web/src/components/SongCard.vue`

The existing `SongCard.vue` is used in History, Playlist, and Queue contexts. It needs to collapse gracefully on narrow screens.

- [ ] **Step 1: Add responsive classes to `SongCard.vue`**

Replace lines 15–16 in the `<template>`:

```vue
      <div class="song-album hidden md:block">{{ song.album }}</div>
      <div class="song-duration hidden sm:block">{{ formatDuration(song.duration) }}</div>
```

- [ ] **Step 2: Add responsive styles to the `<style>` block**

Append to the `<style lang="scss" scoped>` block:

```scss
@media (max-width: 640px) {
  .song-card {
    gap: 8px;
    padding: 6px 10px;
  }
  .song-index {
    width: 18px;
    font-size: 11px;
  }
  .song-name {
    font-size: 13px;
  }
  .song-actions {
    opacity: 1;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SongCard.vue
git commit -m "feat(frontend): responsive SongCard — hide album/duration on narrow screens"
```

---

## Task 7: Final Verification & Cleanup

**Files:**
- Modify: `web/src/styles/index.css` (final polish)

- [ ] **Step 1: Run full type check**

```bash
cd web && npx vue-tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 2: Run production build**

```bash
cd web && npm run build
```

Expected: `vite build` completes successfully.

- [ ] **Step 3: Check for remaining `lang="scss"` in migrated files**

The following files still use SCSS (expected — they were not in Phase 4 scope):
- `App.vue`
- `Navbar.vue`
- `Player.vue`
- `Queue.vue`
- `SongCard.vue`
- `CoverArt.vue`
- `Playlist.vue`
- `History.vue`
- `Lyrics.vue`
- `Setup.vue`

Do NOT remove `sass` from `package.json` yet. That is Phase 5 scope.

- [ ] **Step 4: Run backend tests**

```bash
npm test -- src/audio/queue.test.ts
```

Expected: All tests pass, including the 3 reorder tests.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(frontend): complete Phase 4 frontend experience upgrade"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Design Doc Requirement | Task |
|------------------------|------|
| 搜索页卡片网格布局 | Task 2 (SongGridCard + Search.vue grid) |
| 平台筛选标签栏 | Task 2 (platformTabs + watch re-search) |
| 悬浮效果（卡片上移 + 阴影 + 播放按钮） | Task 2 (SongGridCard hover classes) |
| 搜索无结果 EmptyState | Task 2 (already present) |
| 搜索中 SkeletonLoader | Task 2 (grid of skeletons) |
| 播放器正在播放指示器 | Task 3 (PlayingIndicator.vue) |
| 进度条 rAF 优化 | Task 3 (conditional rAF scheduling) |
| 当前曲目在队列高亮 | Task 4 (Queue.vue `.active` class) |
| 队列拖拽排序 | Task 4 (vuedraggable + backend API) |
| 响应式播放器底部栏 | Task 3 (hidden sm:* classes) |
| 响应式搜索结果 | Task 2 (grid-cols-2 → lg:grid-cols-5) |
| 响应式导航栏汉堡菜单 | Task 5 (hamburger + mobile overlay) |
| 页面过渡动画 | Phase 3 already done (App.vue fade) |
| 列表项交错进入动画 | Task 2 (TransitionGroup + stagger CSS) |

**Gap:** None identified.

### 2. Placeholder Scan

- [ ] No "TBD", "TODO", "implement later", "fill in details"
- [ ] No "Add appropriate error handling" without code
- [ ] No "Write tests for the above" without test code
- [ ] No "Similar to Task N" — each task is self-contained
- [ ] Every step that changes code shows the code

### 3. Type Consistency

- [ ] `reorder(fromIndex, toIndex)` signature matches across `queue.ts`, `player.ts` API, `bot/instance.ts`, and `web/stores/player.ts`
- [ ] `SongGridCard` accepts `Song` type consistent with store definition
- [ ] `vuedraggable` item-key and event types are consistent
- [ ] `onDragEnd` handler uses the same `oldIndex` / `newIndex` property names that `vuedraggable@4` emits

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-phase4-frontend-experience.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review

**Which approach?**
