<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-medium">
        <Icon icon="mdi:theme-light-dark" class="text-lg opacity-60" />
        主题模式
      </div>
      <div class="flex items-center gap-1">
        <button
          v-for="opt in THEME_OPTIONS"
          :key="opt.value"
          class="px-2.5 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium transition-colors"
          :class="store.theme === opt.value ? 'bg-primary text-white' : 'bg-interactive-hover opacity-70 hover:opacity-100'"
          @click="store.setTheme(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
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

    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2 text-sm font-medium shrink-0 pt-0.5">
        <Icon icon="mdi:cellphone-arrow-down" class="text-lg opacity-60" />
        安装到主屏幕
      </div>
      <p class="text-xs text-text-secondary text-right leading-relaxed">
        安卓 Chrome：菜单 →「添加到主屏幕」<br />
        iOS Safari：分享 →「添加到主屏幕」<br />
        桌面 Chrome / Edge：地址栏右侧安装图标
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player';

const store = usePlayerStore();

// 主题：AUTO 跟随系统深浅色（store 内监听 prefers-color-scheme 实时解析）
const THEME_OPTIONS = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'auto' },
] as const;

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
