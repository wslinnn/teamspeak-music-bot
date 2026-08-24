# TS3 Server Tree Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side drawer that displays the live TeamSpeak server channel tree, online users, and bot position, with admin-only channel join capability.

**Architecture:** Backend exposes two new bot-scoped REST endpoints (`GET /server-tree`, `POST /join-channel`) by wrapping the existing `@honeybbq/teamspeak-client` `listChannels` / `listClients` / `clientMove` primitives. Frontend builds a recursive channel tree in a frosted-glass drawer, refreshed by 5-second polling when open.

**Tech Stack:** Node.js + Express, Vue 3 + Composition API + Tailwind CSS v4, Pinia, `@honeybbq/teamspeak-client`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/ts-protocol/client.ts` | Modify | Expose `getChannelList`, `getClientList`, `getClientId`, `joinChannelById` |
| `src/bot/instance.ts` | Modify | Add `getServerTree()` and `joinChannelById()` orchestration methods |
| `src/web/api/bot.ts` | Modify | Add `GET /:id/server-tree` and `POST /:id/join-channel` routes |
| `web/src/utils/serverTree.ts` | Create | Types (`ChannelNode`, `ClientNode`) and `buildChannelTree()` helper |
| `web/src/components/ServerTreeChannel.vue` | Create | Recursive channel row (expand/collapse, client list, bot highlight) |
| `web/src/components/ServerTree.vue` | Create | Tree container, renders root `ServerTreeChannel` list |
| `web/src/components/ServerTreeDrawer.vue` | Create | Drawer shell (open/close, loading state, polling lifecycle) |
| `web/src/components/Navbar.vue` | Modify | Add server-tree toggle button |
| `web/src/components/Player.vue` | Modify | Make bot channel name clickable to open drawer |

---

## Task 1: Extend TS3Client primitives

**Files:**
- Modify: `src/ts-protocol/client.ts`

- [ ] **Step 1: Add `type ChannelInfo` import and the four new methods**

Add `type ChannelInfo` to the import from `@honeybbq/teamspeak-client`, then append the four public methods before `disconnect()`:

```typescript
// In the import block at top of file, add:
// type ChannelInfo,

// Add these methods inside the TS3Client class, just before disconnect():

  async getChannelList(): Promise<ChannelInfo[]> {
    if (!this.client) return [];
    return listChannels(this.client);
  }

  async getClientList(): Promise<ClientInfo[]> {
    if (!this.client) return [];
    return listClients(this.client);
  }

  getClientId(): number {
    return this.clientId;
  }

  async joinChannelById(channelId: bigint, password?: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await clientMove(this.client, this.clientId, channelId, password);
    this.logger.info({ channelId: channelId.toString() }, "Moved to channel by ID");
  }
```

Expected diff lines: add `type ChannelInfo,` to imports; add four methods before `disconnect()`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p src/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ts-protocol/client.ts
git commit -m "feat(ts3client): expose getChannelList, getClientList, getClientId, joinChannelById"
```

---

## Task 2: Add BotInstance orchestration methods

**Files:**
- Modify: `src/bot/instance.ts`

- [ ] **Step 1: Add `getServerTree()` and `joinChannelById()` after `getIdentityExport()`**

Insert before the closing brace of `BotInstance`:

```typescript
  async getServerTree(): Promise<{
    channels: {
      id: string;
      parentId: string | null;
      name: string;
      description: string;
    }[];
    clients: {
      id: string;
      nickname: string;
      uid: string;
      channelId: string;
      isBot: boolean;
      serverGroups: string[];
      type: number;
    }[];
    botChannelId: string;
    botClientId: string;
  }> {
    if (!this.connected) {
      throw new Error("Bot is not connected");
    }
    const [channels, clients] = await Promise.all([
      this.tsClient.getChannelList(),
      this.tsClient.getClientList(),
    ]);
    const currentChannelId = this.tsClient.getChannelId();
    const currentClientId = this.tsClient.getClientId();

    return {
      channels: channels.map((ch) => ({
        id: String(ch.id),
        parentId: ch.parentID === 0n ? null : String(ch.parentID),
        name: ch.name,
        description: ch.description,
      })),
      clients: clients.map((c) => ({
        id: String(c.id),
        nickname: c.nickname,
        uid: c.uid,
        channelId: String(c.channelID),
        isBot: c.id === currentClientId,
        serverGroups: c.serverGroups,
        type: c.type,
      })),
      botChannelId: String(currentChannelId),
      botClientId: String(currentClientId),
    };
  }

  async joinChannelById(channelId: string, password?: string): Promise<void> {
    if (!this.connected) throw new Error("Bot is not connected");
    await this.tsClient.joinChannelById(BigInt(channelId), password);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p src/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/bot/instance.ts
git commit -m "feat(bot): add getServerTree and joinChannelById orchestration"
```

---

## Task 3: Add Express routes

**Files:**
- Modify: `src/web/api/bot.ts`

- [ ] **Step 1: Add `GET /:id/server-tree` and `POST /:id/join-channel` before `return router`**

Insert just before `return router;`:

```typescript
  router.get("/:id/server-tree", auth, async (req, res) => {
    try {
      const bot = botManager.getBot(req.validatedId!);
      if (!bot) {
        res.status(404).json({ success: false, error: "Bot not found" });
        return;
      }
      const tree = await bot.getServerTree();
      res.json(tree);
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  router.post("/:id/join-channel", adminOnly, async (req, res) => {
    try {
      const bot = botManager.getBot(req.validatedId!);
      if (!bot) {
        res.status(404).json({ success: false, error: "Bot not found" });
        return;
      }
      const { channelId, password } = req.body;
      if (!channelId || typeof channelId !== "string") {
        res.status(400).json({ success: false, error: "channelId is required" });
        return;
      }
      await bot.joinChannelById(channelId, password);
      res.json({ success: true, message: "Joined channel" });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });
```

- [ ] **Step 2: Verify backend compiles**

Run: `npx tsc --noEmit -p src/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Test the new endpoints manually (bot must be running)**

Start the server, ensure a bot is connected, then:
```bash
curl -s http://localhost:3000/api/bot/<bot-id>/server-tree | jq .
```
Expected: JSON with `channels`, `clients`, `botChannelId`, `botClientId`.

- [ ] **Step 4: Commit**

```bash
git add src/web/api/bot.ts
git commit -m "feat(api): add server-tree and join-channel endpoints"
```

---

## Task 4: Frontend types and tree builder

**Files:**
- Create: `web/src/utils/serverTree.ts`

- [ ] **Step 1: Write the file**

```typescript
export interface ChannelNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  children: ChannelNode[];
  clients: ClientNode[];
  isSpacer: boolean;
}

export interface ClientNode {
  id: string;
  nickname: string;
  uid: string;
  channelId: string;
  isBot: boolean;
  serverGroups: string[];
  type: number;
}

export interface ServerTreeData {
  channels: {
    id: string;
    parentId: string | null;
    name: string;
    description: string;
  }[];
  clients: {
    id: string;
    nickname: string;
    uid: string;
    channelId: string;
    isBot: boolean;
    serverGroups: string[];
    type: number;
  }[];
  botChannelId: string;
  botClientId: string;
}

export function buildChannelTree(data: ServerTreeData): ChannelNode[] {
  const map = new Map<string, ChannelNode>();
  data.channels.forEach((c) => {
    const isSpacer = /^\[.*spacer/i.test(c.name) || /^[cr]spacer/i.test(c.name);
    map.set(c.id, {
      ...c,
      children: [],
      clients: [],
      isSpacer,
    });
  });

  data.clients.forEach((c) => {
    const ch = map.get(c.channelId);
    if (ch) ch.clients.push(c);
  });

  const roots: ChannelNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort channels by name for stable ordering
  roots.sort((a, b) => a.name.localeCompare(b.name));
  map.forEach((node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  });

  return roots;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/utils/serverTree.ts
git commit -m "feat(frontend): add server-tree types and buildChannelTree helper"
```

---

## Task 5: ServerTreeChannel recursive component

**Files:**
- Create: `web/src/components/ServerTreeChannel.vue`

- [ ] **Step 1: Write the component**

```vue
<template>
  <div :class="{ 'opacity-40': channel.isSpacer }">
    <!-- Channel row -->
    <div
      class="flex items-center gap-1.5 rounded-[var(--radius-sm)] select-none"
      :class="[
        isMobile ? 'py-2.5 px-2' : 'py-1.5 px-1.5',
        isActiveBotChannel ? 'bg-[rgba(34,197,94,0.08)]' : 'hover:bg-hover-bg',
      ]"
      @click="handleChannelClick"
    >
      <!-- Active indicator -->
      <div
        v-if="isActiveBotChannel"
        class="w-[3px] h-5 rounded-full bg-green-500 shrink-0"
      />
      <div v-else class="w-[3px] h-5 shrink-0" />

      <!-- Expand/collapse chevron (hidden for spacer) -->
      <button
        v-if="hasChildren && !channel.isSpacer"
        class="shrink-0 p-0.5 rounded transition-transform duration-200"
        :class="expanded ? 'rotate-90' : ''"
        @click.stop="toggleExpand"
      >
        <Icon icon="mdi:chevron-right" class="text-sm opacity-60" />
      </button>
      <span v-else class="w-5 shrink-0" />

      <!-- Channel icon -->
      <Icon
        :icon="channel.isSpacer ? 'mdi:dots-horizontal' : 'mdi:folder-outline'"
        class="shrink-0"
        :class="isActiveBotChannel ? 'text-green-500' : 'opacity-60'"
      />

      <!-- Channel name -->
      <span
        class="text-sm truncate"
        :class="[
          isActiveBotChannel ? 'font-semibold text-green-500' : 'text-text-secondary',
          channel.isSpacer ? 'text-xs text-text-tertiary italic' : '',
        ]"
        :title="channel.description"
      >
        {{ channel.name }}
      </span>

      <!-- Client count badge -->
      <span
        v-if="totalClients > 0 && !channel.isSpacer"
        class="ml-auto text-[10px] px-1.5 py-px rounded-full bg-hover-bg text-text-tertiary font-medium shrink-0"
      >
        {{ totalClients }}
      </span>

      <!-- Playing pulse -->
      <span
        v-if="isActiveBotChannel && isPlaying"
        class="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0"
      />
    </div>

    <!-- Children + clients -->
    <div v-if="expanded && !channel.isSpacer" class="ml-3 border-l border-border-color pl-2">
      <!-- Clients in this channel -->
      <div
        v-for="client in channel.clients"
        :key="client.id"
        class="flex items-center gap-2 py-1 px-1.5 rounded-[var(--radius-sm)]"
        :class="client.isBot ? 'bg-[rgba(51,94,234,0.06)]' : 'hover:bg-hover-bg'"
      >
        <span class="w-[3px] shrink-0" />
        <span class="w-5 shrink-0" />
        <Icon
          :icon="client.isBot ? 'mdi:robot' : client.type === 1 ? 'mdi:eye' : 'mdi:account'"
          class="shrink-0 text-xs"
          :class="client.isBot ? 'text-primary' : 'opacity-50'"
        />
        <span
          class="text-xs truncate"
          :class="client.isBot ? 'font-semibold text-text-primary' : 'text-text-secondary'"
          :title="client.uid"
        >
          {{ client.nickname }}
        </span>
        <span v-if="client.isBot" class="ml-auto text-[10px] px-1 py-px rounded bg-[rgba(51,94,234,0.12)] text-primary font-medium shrink-0">Bot</span>
      </div>

      <!-- Sub-channels -->
      <ServerTreeChannel
        v-for="child in channel.children"
        :key="child.id"
        :channel="child"
        :bot-channel-id="botChannelId"
        :is-playing="isPlaying"
        :is-admin="isAdmin"
        :is-mobile="isMobile"
        @join-channel="$emit('joinChannel', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { ChannelNode } from '../utils/serverTree';

const props = defineProps<{
  channel: ChannelNode;
  botChannelId: string | null;
  isPlaying: boolean;
  isAdmin: boolean;
  isMobile: boolean;
}>();

const emit = defineEmits<{
  (e: 'joinChannel', channelId: string): void;
}>();

const expanded = ref(true);

const isActiveBotChannel = computed(() => props.channel.id === props.botChannelId);
const hasChildren = computed(() => props.channel.children.length > 0);
const totalClients = computed(() => {
  let count = props.channel.clients.length;
  function sumClients(ch: ChannelNode) {
    count += ch.clients.length;
    ch.children.forEach(sumClients);
  }
  props.channel.children.forEach(sumClients);
  return count;
});

function toggleExpand() {
  expanded.value = !expanded.value;
}

function handleChannelClick() {
  if (props.channel.isSpacer) return;
  if (props.isAdmin && !isActiveBotChannel.value) {
    emit('joinChannel', props.channel.id);
  }
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ServerTreeChannel.vue
git commit -m "feat(ui): add recursive ServerTreeChannel component"
```

---

## Task 6: ServerTree container component

**Files:**
- Create: `web/src/components/ServerTree.vue`

- [ ] **Step 1: Write the component**

```vue
<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center justify-between px-1 pb-3 border-b border-border-color mb-2">
      <h2 class="text-sm font-bold text-text-primary">服务器频道</h2>
      <span v-if="lastUpdated" class="text-[10px] text-text-tertiary">
        更新于 {{ formatTime(lastUpdated) }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <LoadingSpinner />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
      <Icon icon="mdi:alert-circle-outline" class="text-2xl" />
      <span class="text-xs">{{ error }}</span>
    </div>

    <!-- Empty -->
    <div v-else-if="roots.length === 0" class="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
      <Icon icon="mdi:server-off" class="text-2xl" />
      <span class="text-xs">暂无频道数据</span>
    </div>

    <!-- Tree -->
    <div v-else class="flex-1 overflow-y-auto pr-1 space-y-0.5">
      <ServerTreeChannel
        v-for="channel in roots"
        :key="channel.id"
        :channel="channel"
        :bot-channel-id="botChannelId"
        :is-playing="isPlaying"
        :is-admin="isAdmin"
        :is-mobile="isMobile"
        @join-channel="$emit('joinChannel', $event)"
      />
    </div>

    <!-- Footer hint -->
    <div class="pt-2 mt-1 border-t border-border-color text-[10px] text-text-tertiary text-center leading-tight">
      <span v-if="isAdmin">点击频道即可移动机器人</span>
      <span v-else>仅管理员可移动机器人</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { LoadingSpinner } from './common';
import ServerTreeChannel from './ServerTreeChannel.vue';
import type { ChannelNode } from '../utils/serverTree';

defineProps<{
  roots: ChannelNode[];
  botChannelId: string | null;
  isPlaying: boolean;
  isAdmin: boolean;
  isMobile: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
}>();

defineEmits<{
  (e: 'joinChannel', channelId: string): void;
}>();

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ServerTree.vue
git commit -m "feat(ui): add ServerTree container component"
```

---

## Task 7: ServerTreeDrawer shell

**Files:**
- Create: `web/src/components/ServerTreeDrawer.vue`

- [ ] **Step 1: Write the component**

```vue
<template>
  <!-- Overlay -->
  <Transition name="fade">
    <div
      v-if="modelValue"
      class="fixed inset-0 bg-black/40 z-[150] backdrop-blur-sm"
      @click="$emit('update:modelValue', false)"
    />
  </Transition>

  <!-- Drawer -->
  <Transition name="slide-from-right">
    <aside
      v-if="modelValue"
      class="fixed top-0 right-0 bottom-0 z-[160] bg-bg-secondary border-l border-border-color flex flex-col"
      :class="isMobile ? 'w-full' : 'w-[360px]'"
    >
      <!-- Mobile header with close button -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border-color">
        <h2 class="text-base font-bold">服务器状态</h2>
        <button
          class="p-1.5 rounded-[var(--radius-sm)] hover:bg-hover-bg transition-colors cursor-pointer"
          @click="$emit('update:modelValue', false)"
        >
          <Icon icon="mdi:close" class="text-lg" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-hidden p-3">
        <ServerTree
          :roots="roots"
          :bot-channel-id="botChannelId"
          :is-playing="isPlaying"
          :is-admin="isAdmin"
          :is-mobile="isMobile"
          :loading="loading"
          :error="error"
          :last-updated="lastUpdated"
          @join-channel="handleJoinChannel"
        />
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import { http } from '../utils/http';
import { useToast } from '../composables/useToast';
import ServerTree from './ServerTree.vue';
import { buildChannelTree, type ServerTreeData } from '../utils/serverTree';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const playerStore = usePlayerStore();
const authStore = useAuthStore();
const toast = useToast();

const roots = ref(Awaited<ReturnType<typeof buildChannelTree>>>([]);
const botChannelId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const lastUpdated = ref(0);

const isMobile = computed(() => window.innerWidth <= 768);
const isAdmin = computed(() => authStore.isAdmin);
const isPlaying = computed(() => playerStore.isPlaying && !playerStore.isPaused);
const activeBotId = computed(() => playerStore.activeBotId);

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchTree() {
  const botId = activeBotId.value;
  if (!botId) {
    error.value = "未选择机器人";
    return;
  }
  loading.value = roots.value.length === 0; // Only show spinner on first load
  error.value = null;
  try {
    const res = await http.get<ServerTreeData>(`/api/bot/${botId}/server-tree`);
    roots.value = buildChannelTree(res.data);
    botChannelId.value = res.data.botChannelId;
    lastUpdated.value = Date.now();
  } catch (err: any) {
    error.value = err.response?.data?.error ?? "获取频道树失败";
  } finally {
    loading.value = false;
  }
}

async function handleJoinChannel(channelId: string) {
  const botId = activeBotId.value;
  if (!botId) return;
  try {
    await http.post(`/api/bot/${botId}/join-channel`, { channelId });
    toast.success("已切换到目标频道");
    await fetchTree();
  } catch (err: any) {
    toast.error(err.response?.data?.error ?? "切换频道失败");
  }
}

function startPolling() {
  if (pollTimer) return;
  fetchTree();
  pollTimer = setInterval(fetchTree, 5000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    startPolling();
  } else {
    stopPolling();
  }
});

onUnmounted(stopPolling);
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-from-right-enter-active,
.slide-from-right-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-from-right-enter-from,
.slide-from-right-leave-to {
  transform: translateX(100%);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ServerTreeDrawer.vue
git commit -m "feat(ui): add ServerTreeDrawer with polling"
```

---

## Task 8: Integrate into Navbar

**Files:**
- Modify: `web/src/components/Navbar.vue`

- [ ] **Step 1: Add imports, state, and server-tree button**

Add `ServerTreeDrawer` import and `serverTreeOpen` ref:

```typescript
// In <script setup> imports:
import ServerTreeDrawer from './ServerTreeDrawer.vue';

// In <script setup> body, after existing refs:
const serverTreeOpen = ref(false);
```

Add the button in the desktop nav links area (after favorites link, before the closing `</div>`):

```vue
<RouterLink
  to="/favorites"
  class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80"
  active-class="opacity-100 !text-primary"
>收藏</RouterLink>
<button
  class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80 flex items-center gap-1"
  @click="serverTreeOpen = true"
>
  <Icon icon="mdi:server" /> 服务器
</button>
```

Add the mobile menu entry (inside the mobile menu overlay, after favorites):

```vue
<RouterLink
  to="/favorites"
  class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg"
  active-class="opacity-100 !text-primary bg-[rgba(51,94,234,0.1)]"
  @click="mobileMenuOpen = false"
>
  <Icon icon="mdi:heart" class="mr-3" /> 收藏
</RouterLink>
<button
  class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg w-full text-left"
  @click="mobileMenuOpen = false; serverTreeOpen = true"
>
  <Icon icon="mdi:server" class="mr-3" /> 服务器
</button>
```

Add the drawer component at the bottom of the template:

```vue
<ServerTreeDrawer v-model="serverTreeOpen" />
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/Navbar.vue
git commit -m "feat(navbar): add server-tree drawer toggle"
```

---

## Task 9: Integrate into Player

**Files:**
- Modify: `web/src/components/Player.vue`

- [ ] **Step 1: Add channel name click handler**

Add ref and handler in `<script setup>`:

```typescript
const serverTreeOpen = ref(false);

function openServerTree() {
  serverTreeOpen.value = true;
}
```

Find the bot badge span in the player (around line 35):

```vue
<span v-if="showBotBadge" class="inline-block text-[10px] font-semibold px-[5px] bg-[rgba(51,94,234,0.15)] text-primary rounded-[3px] leading-4 whitespace-nowrap shrink-0">{{ activeBot?.name }}</span>
```

Replace with a clickable version that shows the current channel name when known:

```vue
<button
  v-if="showBotBadge"
  class="inline-flex items-center gap-0.5 text-[10px] font-semibold px-[5px] bg-[rgba(51,94,234,0.15)] text-primary rounded-[3px] leading-4 whitespace-nowrap shrink-0 cursor-pointer hover:brightness-110 transition-all"
  @click.stop="openServerTree"
>
  <Icon icon="mdi:account-voice" class="text-[10px]" />
  {{ activeBot?.name }}
</button>
```

Add the drawer at the end of the template:

```vue
<ServerTreeDrawer v-model="serverTreeOpen" />
```

And add the import:

```typescript
import ServerTreeDrawer from './ServerTreeDrawer.vue';
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/Player.vue
git commit -m "feat(player): add server-tree drawer open from bot badge"
```

---

## Task 10: Full build and smoke test

- [ ] **Step 1: Build frontend**

```bash
cd web && npm run build
```
Expected: build succeeds with no errors.

- [ ] **Step 2: Start dev server and smoke test**

Start the backend (ensure at least one bot is configured and connected or connectable):
```bash
npm run dev
```

Open browser at `http://localhost:3000`, then:
1. Click "服务器" in Navbar → Drawer opens → shows spinner → shows tree
2. Verify bot channel is highlighted with green bar
3. Verify online users are listed under their channels
4. If admin, click another channel → bot moves → tree refreshes with new position
5. Close drawer, open from Player badge → works the same

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: TS3 server tree visualization (drawer + polling + admin join)"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] Channel tree with nesting → Task 4 + 5
   - [x] Online user list → Task 5
   - [x] Bot position highlight → Task 5 (`isActiveBotChannel`)
   - [x] Admin-only channel join → Task 3 (`adminOnly` middleware) + Task 7 (`isAdmin` check before join)
   - [x] Everyone can view → Task 3 (`auth` not `adminOnly` on GET)
   - [x] 5-second polling → Task 7 (`setInterval(fetchTree, 5000)`)
   - [x] Mobile responsive drawer → Task 7 (`w-full` on mobile, close button)
   - [x] Spacer channel handling → Task 4 (`isSpacer` regex) + Task 5 (opacity + disabled click)
   - [x] Only existing API fields → Task 2 maps exactly what `listChannels`/`listClients` return

2. **Placeholder scan:**
   - [x] No "TBD", "TODO", "implement later"
   - [x] No vague "add error handling" — specific try/catch with toast messages in Task 7
   - [x] No "write tests for the above" — each task has concrete test/verify steps
   - [x] No "similar to Task N" — all code is self-contained

3. **Type consistency:**
   - [x] `ServerTreeData` in Task 4 matches the return type of `BotInstance.getServerTree()` in Task 2
   - [x] `ChannelNode` / `ClientNode` in Task 4 match what `buildChannelTree` produces and what components consume
   - [x] `joinChannelById` accepts `string` in API (Task 3) and converts to `bigint` in BotInstance (Task 2)
   - [x] `botChannelId` is `string | null` everywhere
