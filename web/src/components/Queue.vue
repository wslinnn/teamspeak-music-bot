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
      class="fixed top-0 bottom-0 right-0 w-[min(360px,85vw)] z-[111] transition-transform duration-[var(--transition-normal)] flex flex-col"
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
            v-if="botQueue.length > 0"
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
              <button class="text-sm opacity-0 p-1 rounded-[var(--radius-sm)] transition-opacity text-text-tertiary hover:text-text-primary group-hover:opacity-100" @click="removeSong(i)" title="移除">
                <Icon icon="mdi:close" />
              </button>
            </div>
          </template>
        </draggable>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, computed } from 'vue';
import { Icon } from '@iconify/vue';
import draggable from 'vuedraggable';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import CoverArt from './CoverArt.vue';
import FavoriteButton from './FavoriteButton.vue';

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
