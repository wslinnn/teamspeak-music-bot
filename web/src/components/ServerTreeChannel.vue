<template>
  <div :class="{ 'opacity-40': channel.isSpacer }">
    <!-- Channel row -->
    <div
      class="flex items-center gap-1.5 rounded-[var(--radius-sm)] select-none"
      :class="[
        isMobile ? 'py-2.5 px-2' : 'py-1.5 px-1.5',
        isActiveBotChannel ? 'bg-[rgba(34,197,94,0.08)]' : 'hover:bg-hover-bg',
      ]"
      @click="handleChannelClick"
    >
      <!-- Active indicator -->
      <div
        v-if="isActiveBotChannel"
        class="w-[3px] h-5 rounded-full bg-green-500 shrink-0"
      />
      <div v-else class="w-[3px] h-5 shrink-0" />

      <!-- Expand/collapse chevron (hidden for spacer) -->
      <button
        v-if="hasChildren && !channel.isSpacer"
        class="shrink-0 p-0.5 rounded transition-transform duration-200"
        :class="expanded ? 'rotate-90' : ''"
        @click.stop="toggleExpand"
      >
        <Icon icon="mdi:chevron-right" class="text-sm opacity-60" />
      </button>
      <span v-else class="w-5 shrink-0" />

      <!-- Channel icon -->
      <Icon
        :icon="channel.isSpacer ? 'mdi:dots-horizontal' : 'mdi:folder-outline'"
        class="shrink-0"
        :class="isActiveBotChannel ? 'text-green-500' : 'opacity-60'"
      />

      <!-- Channel name -->
      <span
        class="text-sm truncate"
        :class="[
          isActiveBotChannel ? 'font-semibold text-green-500' : 'text-text-secondary',
          channel.isSpacer ? 'text-xs text-text-tertiary italic' : '',
        ]"
        :title="channel.description"
      >
        {{ channel.name }}
      </span>

      <!-- Client count badge -->
      <span
        v-if="totalClients > 0 && !channel.isSpacer"
        class="ml-auto text-[10px] px-1.5 py-px rounded-full bg-hover-bg text-text-tertiary font-medium shrink-0"
      >
        {{ totalClients }}
      </span>

      <!-- Playing pulse -->
      <span
        v-if="isActiveBotChannel && isPlaying"
        class="ml-1 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0"
      />
    </div>

    <!-- Children + clients -->
    <div v-if="expanded && !channel.isSpacer" class="ml-3 border-l border-border-color pl-2">
      <!-- Clients in this channel -->
      <div
        v-for="client in channel.clients"
        :key="client.id"
        class="flex items-center gap-2 py-1 px-1.5 rounded-[var(--radius-sm)]"
        :class="client.isBot ? 'bg-[rgba(51,94,234,0.06)]' : 'hover:bg-hover-bg'"
      >
        <span class="w-[3px] shrink-0" />
        <span class="w-5 shrink-0" />
        <Icon
          :icon="client.isBot ? 'mdi:robot' : client.type === 1 ? 'mdi:eye' : 'mdi:account'"
          class="shrink-0 text-xs"
          :class="client.isBot ? 'text-primary' : 'opacity-50'"
        />
        <span
          class="text-xs truncate"
          :class="client.isBot ? 'font-semibold text-text-primary' : 'text-text-secondary'"
          :title="client.uid"
        >
          {{ client.nickname }}
        </span>
        <span v-if="client.isBot" class="ml-auto text-[10px] px-1 py-px rounded bg-[rgba(51,94,234,0.12)] text-primary font-medium shrink-0">Bot</span>
      </div>

      <!-- Sub-channels -->
      <ServerTreeChannel
        v-for="child in channel.children"
        :key="child.id"
        :channel="child"
        :bot-channel-id="botChannelId"
        :is-playing="isPlaying"
        :is-admin="isAdmin"
        :is-mobile="isMobile"
        @join-channel="$emit('joinChannel', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { ChannelNode } from '../utils/serverTree';

const props = defineProps<{
  channel: ChannelNode;
  botChannelId: string | null;
  isPlaying: boolean;
  isAdmin: boolean;
  isMobile: boolean;
}>();

const emit = defineEmits<{
  (e: 'joinChannel', channelId: string): void;
}>();

const expanded = ref(true);

const isActiveBotChannel = computed(() => props.channel.id === props.botChannelId);
const hasChildren = computed(() => props.channel.children.length > 0);
const totalClients = computed(() => {
  let count = props.channel.clients.length;
  function sumClients(ch: ChannelNode) {
    count += ch.clients.length;
    ch.children.forEach(sumClients);
  }
  props.channel.children.forEach(sumClients);
  return count;
});

function toggleExpand() {
  expanded.value = !expanded.value;
}

function handleChannelClick() {
  if (props.channel.isSpacer) return;
  if (props.isAdmin && !isActiveBotChannel.value) {
    emit('joinChannel', props.channel.id);
  }
}
</script>
