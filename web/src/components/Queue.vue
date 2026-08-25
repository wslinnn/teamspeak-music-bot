<template>
  <Teleport to="body">
    <Transition name="queue-backdrop">
      <div
        v-if="open"
        class="fixed inset-0 z-[110] bg-black/40"
        @click="$emit('close')"
      />
    </Transition>
    <div
      class="fixed top-0 bottom-0 right-0 w-[min(360px,85vw)] z-[111] transition-transform duration-[var(--transition-normal)] flex flex-col will-change-transform"
      :style="{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-elevated)' }"
      :class="open ? 'translate-x-0' : 'translate-x-full'"
    >
      <div class="flex items-center justify-between px-5 py-4" :style="{ marginTop: 'var(--navbar-height)' }">
        <div class="flex items-center">
          <h3 class="text-base font-bold">播放队列</h3>
          <span class="ml-2 text-xs text-text-tertiary">{{ botQueue.length }} 首</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="canUseSavedQueues && botQueue.length > 0"
            class="text-lg opacity-60 transition-opacity hover:opacity-100"
            @click="openSaveModal"
            title="保存当前队列为清单"
          >
            <Icon icon="mdi:content-save-outline" />
          </button>
          <button
            v-if="canUseSavedQueues"
            class="text-lg opacity-60 transition-opacity hover:opacity-100"
            @click="openListModal"
            title="已存清单"
          >
            <Icon icon="mdi:playlist-music" />
          </button>
          <button
            v-if="botQueue.length > 0 && canClear"
            class="text-lg opacity-60 transition-opacity hover:opacity-100"
            @click="clearAndStop"
            title="清空队列并停止播放"
          >
            <Icon icon="mdi:stop-circle-outline" />
          </button>
          <button class="text-lg opacity-60 transition-opacity hover:opacity-100" @click="$emit('close')">
            <Icon icon="mdi:close" />
          </button>
        </div>
      </div>

      <div v-if="botQueue.length === 0" class="py-10 px-5 text-center text-text-tertiary text-[13px]">
        队列为空
      </div>

      <div v-else class="flex-1 overflow-y-auto py-2 px-3" :style="{ paddingBottom: 'var(--player-height)' }">
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
              class="flex items-center gap-2 p-2 rounded-[var(--radius-sm)] transition-colors cursor-pointer select-none hover:bg-hover-bg group"
              :class="{ 'bg-[rgba(51,94,234,0.1)]': store.currentSong?.id === song.id }"
              @click="playAtIndex(i)"
            >
              <span class="drag-handle cursor-grab text-foreground-subtle opacity-50 md:opacity-0 md:group-hover:opacity-50 transition-opacity shrink-0 text-base p-0.5 active:opacity-100">
                <Icon icon="mdi:drag-vertical" />
              </span>
              <CoverArt :url="song.coverUrl" :size="32" :radius="4" />
              <div class="flex-1 min-w-0">
                <div class="text-[13px] font-medium truncate">{{ song.name }}</div>
                <div class="text-[11px] text-text-secondary">{{ song.artist }}</div>
              </div>
              <FavoriteButton
                :song-id="song.id"
                :platform="song.platform"
                :song-name="song.name"
                :artist="song.artist"
                :cover-url="song.coverUrl"
                :duration="song.duration"
              />
              <button v-if="canRemove" class="text-sm opacity-0 p-1 rounded-[var(--radius-sm)] transition-opacity text-text-tertiary hover:text-text-primary group-hover:opacity-100" @click="removeSong(i)" title="移除">
                <Icon icon="mdi:close" />
              </button>
            </div>
          </template>
        </draggable>
      </div>
    </div>

    <!-- Save queue modal -->
    <BaseModal v-model="saveModalOpen" title="保存当前队列">
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">清单名称</label>
          <input
            v-model="saveName"
            class="input"
            placeholder="例如：周末歌单"
            maxlength="50"
            @keyup.enter="saveQueue"
          />
        </div>
        <BaseToggle v-model="saveShared" label="共享清单" hint="所有用户可见（否则仅自己可见）" />
      </div>
      <template #footer="{ close }">
        <BaseButton variant="secondary" @click="close">取消</BaseButton>
        <BaseButton :loading="savingQueue" :disabled="!saveName.trim()" @click="saveQueue">保存</BaseButton>
      </template>
    </BaseModal>

    <!-- Saved queues list modal -->
    <BaseModal v-model="listModalOpen" title="已存清单">
      <div v-if="savedLoading" class="py-4">
        <SkeletonLoader height="48px" class="mb-2" />
        <SkeletonLoader height="48px" class="mb-2" />
        <SkeletonLoader height="48px" />
      </div>
      <EmptyState v-else-if="savedQueues.length === 0" message="暂无已存清单" icon="mdi:playlist-music-outline" />
      <div v-else class="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
        <div
          v-for="sq in savedQueues"
          :key="sq.id"
          class="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-hover-bg group"
        >
          <Icon icon="mdi:playlist-music" class="text-lg opacity-50 shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {{ sq.name }}
              <span
                v-if="sq.shared"
                class="text-[10px] font-semibold px-1 py-px rounded bg-primary/15 text-primary align-middle"
              >共享</span>
            </div>
            <div class="text-xs text-text-tertiary">{{ sq.songCount }} 首</div>
          </div>
          <button class="text-sm px-2 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium bg-interactive-hover hover:bg-primary hover:text-white transition-colors" title="替换当前队列并播放" @click="loadQueue(sq, 'replace')">
            加载
          </button>
          <button class="text-sm px-2 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium bg-interactive-hover hover:bg-primary hover:text-white transition-colors" title="追加到队列末尾" @click="loadQueue(sq, 'append')">
            追加
          </button>
          <button class="text-base opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-text-tertiary hover:text-danger" title="删除" @click="deleteQueue(sq)">
            <Icon icon="mdi:close" />
          </button>
        </div>
      </div>
    </BaseModal>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import draggable from 'vuedraggable';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../composables/useToast';
import CoverArt from './CoverArt.vue';
import FavoriteButton from './FavoriteButton.vue';
import BaseModal from './common/BaseModal.vue';
import BaseButton from './common/BaseButton.vue';
import BaseToggle from './common/BaseToggle.vue';
import SkeletonLoader from './common/SkeletonLoader.vue';
import EmptyState from './common/EmptyState.vue';

interface SavedQueue {
  id: number;
  name: string;
  songCount: number;
  shared: boolean;
}

const props = defineProps<{
  open: boolean;
}>();

defineEmits<{
  close: [];
}>();

const store = usePlayerStore();
const auth = useAuthStore();
const botQueue = computed(() => store.queue);
// 队列操作显隐（D14）：清空=控制权或游客 removeClear；移除单曲=入队权或游客 removeClear
const canClear = computed(() => auth.can('player.control') || auth.guestCan('removeClear'));
const canRemove = computed(() => auth.can('player.queue') || auth.guestCan('removeClear'));
// 已存清单：需管理员在 设置→行为 开启（savedQueuesEnabled），且游客无此功能
const canUseSavedQueues = computed(() => store.savedQueuesEnabled && !auth.isGuest);

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
  } catch (err) {
    console.warn('Failed to remove song from queue:', err);
  }
}

async function clearAndStop() {
  try {
    await store.stop();
    await store.fetchQueue();
  } catch {
    // Ignore
  }
}

async function onDragEnd(evt: { oldIndex: number; newIndex: number }) {
  if (evt.oldIndex === evt.newIndex) return;
  await store.reorderQueue(evt.oldIndex, evt.newIndex);
}

// ── Saved queues（受 设置→行为 的 savedQueuesEnabled 门控）──
const toast = useToast();
const saveModalOpen = ref(false);
const saveName = ref('');
const saveShared = ref(false);
const savingQueue = ref(false);
const listModalOpen = ref(false);
const savedLoading = ref(false);
const savedQueues = ref<SavedQueue[]>([]);

function savedQueuesDisabledHint(err: unknown): string {
  const status = (err as any)?.response?.status;
  const msg = (err as any)?.response?.data?.error ?? '';
  if (status === 403 || String(msg).includes('未启用')) {
    return '此功能未启用：到 设置 → 行为设置 开启「保存/加载播放清单」';
  }
  return typeof msg === 'string' && msg ? msg : '操作失败';
}

function openSaveModal() {
  saveName.value = '';
  saveShared.value = false;
  saveModalOpen.value = true;
}

async function saveQueue() {
  if (!store.activeBotId || !saveName.value.trim()) return;
  savingQueue.value = true;
  try {
    await http.post('/api/saved-queues', {
      botId: store.activeBotId,
      name: saveName.value.trim(),
      shared: saveShared.value,
    });
    toast.success(`清单「${saveName.value.trim()}」已保存`);
    saveModalOpen.value = false;
  } catch (err) {
    toast.error(savedQueuesDisabledHint(err));
  } finally {
    savingQueue.value = false;
  }
}

async function openListModal() {
  listModalOpen.value = true;
  savedLoading.value = true;
  try {
    const res = await http.get('/api/saved-queues');
    savedQueues.value = res.data.queues ?? [];
  } catch (err) {
    toast.error(savedQueuesDisabledHint(err));
    savedQueues.value = [];
  } finally {
    savedLoading.value = false;
  }
}

async function loadQueue(sq: SavedQueue, mode: 'replace' | 'append') {
  if (!store.activeBotId) return;
  try {
    await http.post(`/api/saved-queues/${sq.id}/load`, {
      botId: store.activeBotId,
      mode,
    });
    await store.fetchQueue();
    toast.success(mode === 'append' ? `已追加 ${sq.songCount} 首` : `已加载「${sq.name}」`);
    listModalOpen.value = false;
  } catch (err) {
    toast.error(savedQueuesDisabledHint(err));
  }
}

async function deleteQueue(sq: SavedQueue) {
  if (!confirm(`删除清单「${sq.name}」？`)) return;
  try {
    await http.delete(`/api/saved-queues/${sq.id}`);
    savedQueues.value = savedQueues.value.filter((q) => q.id !== sq.id);
  } catch (err) {
    toast.error(savedQueuesDisabledHint(err));
  }
}
</script>

<style scoped>
.queue-backdrop-enter-active,
.queue-backdrop-leave-active {
  transition: opacity 0.25s ease;
}
.queue-backdrop-enter-from,
.queue-backdrop-leave-to {
  opacity: 0;
}

.queue-item-ghost {
  opacity: 0.5;
  background: var(--hover-bg);
}

.queue-item-drag {
  opacity: 0.9;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-elevated);
}
</style>
