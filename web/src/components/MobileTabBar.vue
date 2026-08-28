<template>
  <nav class="fixed bottom-0 left-0 right-0 z-[var(--z-navbar)] frosted-glass flex md:hidden h-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors duration-[var(--transition-fast)]"
      :class="isActive(tab) ? 'text-primary' : 'text-text-tertiary'"
    >
      <Icon :icon="tab.icon" class="text-[22px]" aria-hidden="true" />
      <span class="text-[11px] leading-[1.15] max-w-full truncate">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const auth = useAuthStore();

// 播放历史/收藏并入「我的」（/library 子 Tab）；设置同为 blockGuest 路由，
// 游客不渲染入口（D14 渲染层门控）
const tabs = computed(() => [
  { to: '/', label: '发现', icon: 'mdi:home' },
  { to: '/search', label: '搜索', icon: 'mdi:magnify' },
  ...(!auth.isGuest ? [{ to: '/library', label: '我的', icon: 'mdi:music-box-multiple' }] : []),
  ...(!auth.isGuest ? [{ to: '/settings', label: '设置', icon: 'mdi:cog' }] : []),
]);

function isActive(tab: { to: string }): boolean {
  if (tab.to === '/settings') return route.path.startsWith('/settings');
  return route.path === tab.to;
}
</script>
