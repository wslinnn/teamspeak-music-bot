<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
        @click="close"
      />
    </Transition>

    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="modelValue"
        class="fixed bottom-0 left-0 right-0 z-[201] bg-bg-primary rounded-t-2xl px-6 pt-4 pb-8 sm:hidden"
      >
        <!-- Drag handle -->
        <div class="flex justify-center mb-5" @click="close">
          <div class="w-10 h-1 rounded-full bg-border-color" />
        </div>

        <!-- Volume section -->
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-text-secondary">音量</span>
            <span class="text-sm text-text-primary font-semibold tabular-nums">{{ volume }}%</span>
          </div>
          <div class="flex items-center gap-3">
            <Icon icon="mdi:volume-low" class="text-xl text-text-tertiary shrink-0" />
            <input
              type="range"
              min="0"
              max="100"
              :value="volume"
              @input="onVolumeInput"
              class="mobile-volume-slider flex-1"
            />
            <Icon icon="mdi:volume-high" class="text-xl text-text-tertiary shrink-0" />
          </div>
        </div>

        <!-- Divider -->
        <div class="h-px bg-border-color mb-5" />

        <!-- Play mode section -->
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="mode in modes"
            :key="mode.key"
            class="flex flex-col items-center gap-1.5 py-3 rounded-xl transition-colors"
            :class="currentMode === mode.key ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-hover-bg'"
            @click="setMode(mode.key)"
          >
            <Icon :icon="mode.icon" class="text-xl" />
            <span class="text-[11px]">{{ mode.label }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const store = usePlayerStore();
const activeBot = computed(() => store.activeBot);
const volume = computed(() => activeBot.value?.volume ?? 75);
const currentMode = computed(() => activeBot.value?.playMode ?? 'seq');

const modes = [
  { key: 'seq', label: '顺序', icon: 'mdi:arrow-right' },
  { key: 'loop', label: '循环', icon: 'mdi:repeat' },
  { key: 'random', label: '随机', icon: 'mdi:shuffle' },
  { key: 'rloop', label: '随机循环', icon: 'mdi:shuffle-variant' },
];

function close() {
  emit('update:modelValue', false);
}

function onVolumeInput(e: Event) {
  const target = e.target as HTMLInputElement;
  store.setVolume(parseInt(target.value));
}

function setMode(mode: string) {
  store.setMode(mode);
}
</script>

<style scoped>
.mobile-volume-slider {
  height: 6px;
  appearance: none;
  background: var(--hover-bg);
  border-radius: 999px;
  outline: none;
}
.mobile-volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
.mobile-volume-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
</style>
