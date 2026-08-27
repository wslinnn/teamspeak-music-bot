<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-medium">
        <Icon icon="mdi:theme-light-dark" class="text-lg opacity-60" />
        主题模式
      </div>
      <BaseButton variant="secondary" size="sm" @click="store.toggleTheme()">
        <Icon :icon="store.theme === 'dark' ? 'mdi:weather-night' : 'mdi:weather-sunny'" class="mr-1" />
        {{ store.theme === 'dark' ? '深色' : '浅色' }}
      </BaseButton>
    </div>

    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-medium">
        <Icon icon="mdi:format-letter-case" class="text-lg opacity-60" />
        歌词字号
      </div>
      <div class="flex items-center gap-1">
        <button
          v-for="opt in FONT_OPTIONS"
          :key="opt.value"
          class="px-2.5 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium transition-colors"
          :class="fontScale === opt.value ? 'bg-primary text-white' : 'bg-interactive-hover opacity-70 hover:opacity-100'"
          @click="setFontScale(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div v-if="canInstall || showIosHint" class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-medium">
        <Icon icon="mdi:cellphone-arrow-down" class="text-lg opacity-60" />
        安装到主屏幕
      </div>
      <BaseButton v-if="canInstall" variant="secondary" size="sm" @click="install">安装</BaseButton>
      <span v-else class="text-xs text-text-secondary">iOS：分享 → 添加到主屏幕</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player';
import { usePwaInstall } from '../../composables/usePwaInstall';
import BaseButton from '../common/BaseButton.vue';

const store = usePlayerStore();
const { canInstall, showIosHint, install } = usePwaInstall();

// 歌词字号：纯本地显示偏好（与主题同级），三档缩放正文/活跃行/译文
const FONT_OPTIONS = [
  { label: '紧凑', value: 0.85 },
  { label: '标准', value: 1 },
  { label: '特大', value: 1.25 },
] as const;

const fontScale = ref(readFontScale());

function readFontScale(): number {
  try {
    const v = parseFloat(localStorage.getItem('lyrics.fontScale') ?? '1');
    return v === 0.85 || v === 1 || v === 1.25 ? v : 1;
  } catch {
    return 1;
  }
}

function setFontScale(value: number): void {
  fontScale.value = value;
  try {
    localStorage.setItem('lyrics.fontScale', String(value));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
</script>
