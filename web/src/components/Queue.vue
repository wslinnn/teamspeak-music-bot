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
            <FavoriteButton
              :song-id="song.id"
              :platform="song.platform"
              :song-name="song.name"
              :artist="song.artist"
              :cover-url="song.coverUrl"
            />
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
}

.queue-panel.open {
  right: 0;
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
}
.close-btn:hover { opacity: 1; }

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
}

.queue-item:hover {
  background: var(--hover-bg);
}
.queue-item:hover .remove-btn { opacity: 1; }
.queue-item:hover .drag-handle { opacity: 0.5 !important; }

.queue-item.active {
  background: rgba(51, 94, 234, 0.1);
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
}
.remove-btn:hover { color: var(--text-primary); }

.drag-handle {
  font-size: 16px;
  padding: 2px;
  flex-shrink: 0;
}
</style>
