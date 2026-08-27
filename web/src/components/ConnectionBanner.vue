<template>
  <Transition name="banner">
    <div
      v-if="state !== 'connected'"
      class="fixed top-[var(--navbar-height)] left-0 right-0 z-[var(--z-navbar)] flex items-center justify-center gap-2 py-1.5 text-[12px] font-medium"
      :class="state === 'reconnecting' ? 'bg-amber-500/15 text-amber-600' : 'bg-red-500/15 text-red-600'"
    >
      <Icon
        :icon="state === 'reconnecting' ? 'mdi:reload' : 'mdi:alert-circle-outline'"
        :class="state === 'reconnecting' ? 'animate-spin' : ''"
        class="text-base shrink-0"
      />
      <span>{{ state === 'reconnecting' ? '与服务器的连接已断开，正在重连…' : '与服务器的连接失败' }}</span>
      <button
        v-if="state === 'disconnected'"
        class="ml-1 px-2 py-0.5 rounded-[var(--radius-sm)] border border-current transition-opacity hover:opacity-80"
        @click="$emit('reconnect')"
      >
        重新连接
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import type { ConnectionState } from '../composables/useWebSocket';

// WS 认证失败（4001）时后端已有 toast 引导重新登录，这里仅如实展示状态
defineProps<{ state: ConnectionState }>();
defineEmits<{ reconnect: [] }>();
</script>

<style scoped>
.banner-enter-active,
.banner-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}
.banner-enter-from,
.banner-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
