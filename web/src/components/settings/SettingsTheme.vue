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
          :class="store.theme === opt.value ? 'bg-primary text-on-primary' : 'bg-interactive-hover opacity-70 hover:opacity-100'"
          @click="store.setTheme(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- 主题强调色：预设色板（自定义取色器二期） -->
    <div>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm font-medium">
          <Icon icon="mdi:palette-outline" class="text-lg opacity-60" />
          主题色
        </div>
        <button
          type="button"
          class="text-xs text-text-secondary hover:text-text-primary transition-colors"
          @click="chooseAccent(DEFAULT_ACCENT)"
        >
          恢复默认
        </button>
      </div>
      <p class="text-xs text-text-secondary mt-1 leading-relaxed">
        设置按钮、选中状态和进度条的强调色，点击即可预览，保存后多端同步。
      </p>
      <div class="flex flex-wrap gap-2.5 mt-3" role="group" aria-label="预设主题色">
        <button
          v-for="preset in ACCENT_PRESETS"
          :key="preset.color"
          type="button"
          class="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-md)] transition-colors"
          :class="store.accentColor === preset.color ? 'bg-interactive-hover' : 'hover:bg-interactive-hover'"
          :aria-pressed="store.accentColor === preset.color"
          :aria-label="preset.name"
          @click="chooseAccent(preset.color)"
        >
          <span
            class="grid place-items-center w-8 h-8 rounded-full border border-white/10"
            :style="{ background: preset.color, color: accentTokens(preset.color)['--color-on-primary'] }"
          >
            <Icon v-if="store.accentColor === preset.color" icon="mdi:check" class="text-lg" />
          </span>
          <span class="text-[11px]" :class="store.accentColor === preset.color ? 'text-text-primary' : 'text-text-secondary'">
            {{ preset.name }}
          </span>
        </button>
      </div>
      <div class="flex items-center gap-3 mt-4 flex-wrap">
        <button
          type="button"
          class="px-4 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium bg-primary text-on-primary disabled:opacity-50 disabled:cursor-default"
          :disabled="accentSaving || !accentDirty"
          @click="saveAccent"
        >
          {{ accentSaving ? '保存中…' : '保存' }}
        </button>
        <span class="text-[11px] text-text-secondary" aria-live="polite">
          {{ accentDirty ? '有未保存的修改' : '已保存' }}
        </span>
      </div>
      <p v-if="accentSaveError" class="text-xs text-danger mt-1.5">{{ accentSaveError }}</p>
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
          :class="fontScale === opt.value ? 'bg-primary text-on-primary' : 'bg-interactive-hover opacity-70 hover:opacity-100'"
          @click="setFontScale(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2 text-sm font-medium shrink-0">
        <Icon icon="mdi:cellphone-arrow-down" class="text-lg opacity-60" />
        安装到主屏幕
      </div>
      <details class="text-right">
        <summary class="cursor-pointer text-xs text-primary select-none">查看安装方法</summary>
        <p class="text-xs text-text-secondary text-right leading-relaxed mt-1.5">
          安卓 Chrome：菜单 →「添加到主屏幕」<br />
          iOS Safari：分享 →「添加到主屏幕」<br />
          桌面 Chrome / Edge：地址栏右侧安装图标
        </p>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player';
import { useAuthStore } from '../../stores/auth';
import { useLyricsFontScale } from '../../composables/useLyricsFontScale';
import { ACCENT_PRESETS, DEFAULT_ACCENT, accentTokens, readGuestAccent, normalizeAccent } from '../../styles/accent';

const store = usePlayerStore();
const authStore = useAuthStore();
const { fontScale, setFontScale } = useLyricsFontScale();

// 主题：AUTO 跟随系统深浅色（store 内监听 prefers-color-scheme 实时解析）
const THEME_OPTIONS = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '跟随系统', value: 'auto' },
] as const;

// ── 主题强调色 ──
const accentSaving = ref(false);
const accentSaveError = ref('');
/** 游客的已保存基线：保存成功 cookie 后才更新，用于脏状态判断 */
const guestSavedAccent = ref(readGuestAccent());
const accentDirty = computed(() => {
  const saved = authStore.isGuest
    ? guestSavedAccent.value
    : normalizeAccent(authStore.user?.accentColor ?? '') ?? DEFAULT_ACCENT;
  return store.accentColor !== saved;
});

function chooseAccent(color: string) {
  store.setAccentColor(color);
  accentSaveError.value = '';
}

async function saveAccent() {
  if (accentSaving.value || !accentDirty.value) return;
  const color = store.accentColor;
  accentSaving.value = true;
  accentSaveError.value = '';
  try {
    if (authStore.isGuest) {
      store.saveGuestAccentColor();
      guestSavedAccent.value = color;
    } else {
      await authStore.saveAccentColor(color);
    }
  } catch (error) {
    accentSaveError.value = (error as Error).message || '主题色保存失败，请稍后重试。';
  } finally {
    accentSaving.value = false;
  }
}

// 歌词字号：纯本地显示偏好（与主题同级），三档缩放正文/活跃行/译文
const FONT_OPTIONS = [
  { label: '紧凑', value: 0.85 },
  { label: '标准', value: 1 },
  { label: '特大', value: 1.25 },
] as const;
</script>
