<template>
  <!-- Search Bar -->
  <div
    class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3 mb-8 cursor-pointer transition-colors hover:bg-interactive-hover"
    role="button"
    tabindex="0"
    @click="$router.push('/search')"
    @keydown.enter="$router.push('/search')"
  >
    <Icon icon="mdi:magnify" class="mr-3 text-xl opacity-40" />
    <span class="text-sm opacity-30">搜索歌曲、歌单、专辑...</span>
  </div>

  <!-- FM -->
  <section v-if="canStartFm" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">私人FM</h2>
    <div
      class="group flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5 cursor-pointer transition-colors hover:bg-interactive-hover"
      role="button"
      tabindex="0"
      @click="playFm"
      @keydown.enter="playFm"
    >
      <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-primary to-indigo-500">
        <Icon icon="mdi:radio" class="text-[28px] text-white" />
      </div>
      <div class="flex-1">
        <div class="text-base font-semibold">开启私人FM</div>
        <div class="text-[13px] text-foreground-muted">根据你的口味推荐音乐</div>
      </div>
      <Icon icon="mdi:play-circle" class="text-4xl text-primary opacity-80 transition-opacity group-hover:opacity-100" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { http } from '../../utils/http';
import { usePlayerStore } from '../../stores/player';
import { useAuthStore } from '../../stores/auth';
import { useToast } from '../../composables/useToast';

const router = useRouter();
const store = usePlayerStore();
const auth = useAuthStore();
const toast = useToast();

// /fm 需 player.control 或游客 playMode 开关（与 D14 门控口径一致）
const canStartFm = computed(() => auth.can('player.control') || auth.guestCan('playMode'));

async function playFm() {
  if (!store.activeBotId) {
    toast.error('暂无可用的机器人');
    return;
  }
  // 唤醒后端 POST /api/player/:id/fm：由服务端接管 FM 模式（自动拉歌/续播）
  try {
    const res = await http.post(`/api/player/${store.activeBotId}/fm`, { platform: 'netease' });
    if (res.data.ok) {
      toast.success('私人FM已开启');
    } else {
      toast.error(res.data.message || '开启私人FM失败');
    }
  } catch {
    toast.error('开启私人FM失败');
  }
}
</script>
