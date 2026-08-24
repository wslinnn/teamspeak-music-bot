<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center justify-between px-1 pb-3 border-b border-border-color mb-2">
      <h2 class="text-sm font-bold text-text-primary">服务器频道</h2>
      <span v-if="lastUpdated" class="text-[10px] text-text-tertiary">
        更新于 {{ formatTime(lastUpdated) }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <LoadingSpinner />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
      <Icon icon="mdi:alert-circle-outline" class="text-2xl" />
      <span class="text-xs">{{ error }}</span>
    </div>

    <!-- Empty -->
    <div v-else-if="roots.length === 0" class="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
      <Icon icon="mdi:server-off" class="text-2xl" />
      <span class="text-xs">暂无频道数据</span>
    </div>

    <!-- Tree -->
    <div v-else class="flex-1 overflow-y-auto pr-1 space-y-0.5">
      <ServerTreeChannel
        v-for="channel in roots"
        :key="channel.id"
        :channel="channel"
        :bot-channel-id="botChannelId"
        :is-playing="isPlaying"
        :is-admin="isAdmin"
        :is-mobile="isMobile"
        @join-channel="$emit('joinChannel', $event)"
      />
    </div>

    <!-- Footer hint -->
    <div class="pt-2 mt-1 border-t border-border-color text-[10px] text-text-tertiary text-center leading-tight">
      <span v-if="isAdmin">点击频道即可移动机器人</span>
      <span v-else>仅管理员可移动机器人</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { LoadingSpinner } from './common';
import ServerTreeChannel from './ServerTreeChannel.vue';
import type { ChannelNode } from '../utils/serverTree';

defineProps<{
  roots: ChannelNode[];
  botChannelId: string | null;
  isPlaying: boolean;
  isAdmin: boolean;
  isMobile: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
}>();

defineEmits<{
  (e: 'joinChannel', channelId: string): void;
}>();

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>
