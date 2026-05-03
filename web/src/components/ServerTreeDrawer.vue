<template>
  <!-- Overlay -->
  <Transition name="fade">
    <div
      v-if="modelValue"
      class="fixed inset-0 bg-black/40 z-[150] backdrop-blur-sm"
      @click="$emit('update:modelValue', false)"
    />
  </Transition>

  <!-- Drawer -->
  <Transition name="slide-from-right">
    <aside
      v-if="modelValue"
      class="fixed top-0 right-0 bottom-0 z-[160] bg-bg-secondary border-l border-border-color flex flex-col will-change-transform"
      :class="isMobile ? 'w-full' : 'w-[360px]'"
    >
      <!-- Mobile header with close button -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border-color">
        <h2 class="text-base font-bold">服务器状态</h2>
        <button
          class="p-1.5 rounded-[var(--radius-sm)] hover:bg-hover-bg transition-colors cursor-pointer"
          @click="$emit('update:modelValue', false)"
        >
          <Icon icon="mdi:close" class="text-lg" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-hidden p-3">
        <ServerTree
          :roots="roots"
          :bot-channel-id="botChannelId"
          :is-playing="isPlaying"
          :is-admin="isAdmin"
          :is-mobile="isMobile"
          :loading="loading"
          :error="error"
          :last-updated="lastUpdated"
          @join-channel="handleJoinChannel"
        />
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import { http } from '../utils/http';
import { useToast } from '../composables/useToast';
import ServerTree from './ServerTree.vue';
import { buildChannelTree, type ServerTreeData } from '../utils/serverTree';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const playerStore = usePlayerStore();
const authStore = useAuthStore();
const toast = useToast();

const roots = ref<ReturnType<typeof buildChannelTree>>([]);
const botChannelId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const lastUpdated = ref(0);

const isMobile = ref(window.innerWidth <= 768);
const isAdmin = computed(() => authStore.isAdmin);
const isPlaying = computed(() => playerStore.isPlaying && !playerStore.isPaused);
const activeBotId = computed(() => playerStore.activeBotId);

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchTree() {
  const botId = activeBotId.value;
  if (!botId) {
    error.value = "未选择机器人";
    return;
  }
  loading.value = roots.value.length === 0;
  error.value = null;
  try {
    const res = await http.get<ServerTreeData>(`/api/bot/${botId}/server-tree`);
    roots.value = buildChannelTree(res.data);
    botChannelId.value = res.data.botChannelId;
    lastUpdated.value = Date.now();
  } catch (err: any) {
    error.value = err.response?.data?.error ?? "获取频道树失败";
  } finally {
    loading.value = false;
  }
}

async function handleJoinChannel(channelId: string) {
  const botId = activeBotId.value;
  if (!botId) return;
  try {
    await http.post(`/api/bot/${botId}/join-channel`, { channelId });
    toast.success("已切换到目标频道");
    await fetchTree();
  } catch (err: any) {
    toast.error(err.response?.data?.error ?? "切换频道失败");
  }
}

function startPolling() {
  if (pollTimer) return;
  fetchTree();
  pollTimer = setInterval(fetchTree, 5000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    startPolling();
  } else {
    stopPolling();
  }
});

onMounted(() => {
  window.addEventListener('resize', updateIsMobile);
});

onUnmounted(() => {
  stopPolling();
  window.removeEventListener('resize', updateIsMobile);
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-from-right-enter-active,
.slide-from-right-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-from-right-enter-from,
.slide-from-right-leave-to {
  transform: translateX(100%);
}
</style>
