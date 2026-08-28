<template>
  <div class="home">
    <!-- 无机器人引导：管理员直达创建，成员/游客说明等待 -->
    <div v-if="botsLoaded && store.bots.length === 0" class="mb-9 flex flex-col items-center gap-3 rounded-[var(--radius-lg)] bg-surface-card py-12 text-center">
      <Icon icon="mdi:robot-outline" class="text-5xl text-text-tertiary" />
      <div class="text-base font-semibold">还没有音乐机器人</div>
      <p class="text-sm text-text-tertiary">
        {{ authStore.isAdmin ? '创建一个并连接到你的 TeamSpeak 服务器即可开始点歌' : '请联系管理员在设置中添加机器人' }}
      </p>
      <RouterLink
        v-if="authStore.isAdmin"
        to="/settings?tab=bots"
        class="mt-1 flex items-center gap-1.5 px-6 py-2.5 bg-primary text-white rounded-[var(--radius-lg)] text-sm font-semibold transition-transform hover:scale-[1.04] active:scale-[0.96]"
      >
        <Icon icon="mdi:plus" />
        去创建机器人
      </RouterLink>
    </div>

    <QuickActions />
    <NowPlaying />
    <JellyfinSections />
    <RecentHistory />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import QuickActions from '../components/home/QuickActions.vue';
import NowPlaying from '../components/home/NowPlaying.vue';
import JellyfinSections from '../components/home/JellyfinSections.vue';
import RecentHistory from '../components/home/RecentHistory.vue';

const store = usePlayerStore();
const authStore = useAuthStore();
const botsLoaded = ref(false);

onMounted(async () => {
  store.fetchHomeData();
  // 无机器人引导卡依赖 bots 列表；无 bot 时 fetchBots 才会真正发请求
  if (store.bots.length === 0) {
    await store.fetchBots().catch(() => {});
  }
  botsLoaded.value = true;
});
</script>
