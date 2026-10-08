<template>
  <BaseModal
    :model-value="modal.open"
    title="选择分P"
    @update:model-value="store.closeBilibiliPartModal"
  >
    <div class="flex items-center gap-3 mb-4">
      <CoverArt :url="modal.coverUrl" :size="44" :radius="8" />
      <div class="min-w-0">
        <div class="text-sm font-medium truncate" :title="modal.title">{{ modal.title }}</div>
        <div class="text-xs text-text-tertiary mt-0.5">共 {{ modal.parts.length }} 个分P · {{ actionHint }}</div>
      </div>
    </div>

    <div class="flex flex-col gap-1 max-h-[46vh] overflow-y-auto">
      <button
        v-for="part in modal.parts"
        :key="part.part"
        class="flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-md)] text-left transition-colors"
        :class="selectedPart?.part === part.part
          ? 'bg-primary/15 text-primary'
          : 'hover:bg-interactive-hover'"
        @click="selectedPart = part"
        @dblclick="store.selectBilibiliPart(part)"
      >
        <span
          class="shrink-0 min-w-[2.2rem] text-center text-xs font-semibold rounded-md px-1.5 py-0.5"
          :class="selectedPart?.part === part.part ? 'bg-primary text-white' : 'bg-surface-card text-text-secondary'"
        >P{{ part.part }}</span>
        <span class="flex-1 text-sm truncate" :title="part.title">{{ part.title }}</span>
        <span class="shrink-0 text-xs text-text-tertiary tabular-nums">{{ formatDuration(part.duration) }}</span>
      </button>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="store.closeBilibiliPartModal">取消</BaseButton>
      <BaseButton :disabled="!selectedPart" @click="selectedPart && store.selectBilibiliPart(selectedPart)">
        {{ confirmBtnText }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { usePlayerStore, type BiliPart } from '../stores/player.js';
import BaseModal from './common/BaseModal.vue';
import BaseButton from './common/BaseButton.vue';
import CoverArt from './CoverArt.vue';

const store = usePlayerStore();
const modal = computed(() => store.biliPartModal);

const selectedPart = ref<BiliPart | null>(null);

// 弹窗打开时默认选中第 1 P
watch(
  () => modal.value.open,
  (open) => {
    selectedPart.value = open && modal.value.parts.length > 0 ? modal.value.parts[0] : null;
  },
  { immediate: true },
);

const actionHint = computed(() => {
  if (modal.value.action === 'playNext') return '添加到下一首播放';
  if (modal.value.action === 'add') return '添加到播放队列';
  return '立即播放';
});

const confirmBtnText = computed(() => {
  if (modal.value.action === 'playNext') return '下一首播放';
  if (modal.value.action === 'add') return '添加到队列';
  return '播放';
});

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>
