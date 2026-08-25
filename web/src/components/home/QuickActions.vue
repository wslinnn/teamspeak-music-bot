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

  <!-- FM（多源：按启用状态与登录态显隐） -->
  <section v-if="canStartFm && fmCards.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">私人FM</h2>
    <div class="flex flex-col gap-3">
      <div
        v-for="card in fmCards"
        :key="card.platform"
        class="group flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5 cursor-pointer transition-colors hover:bg-interactive-hover"
        role="button"
        tabindex="0"
        @click="playFm(card.platform)"
        @keydown.enter="playFm(card.platform)"
      >
        <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br" :class="card.gradient">
          <Icon :icon="card.icon" class="text-[28px] text-white" />
        </div>
        <div class="flex-1">
          <div class="text-base font-semibold">{{ card.title }}</div>
          <div class="text-[13px] text-foreground-muted">{{ card.desc }}</div>
        </div>
        <Icon icon="mdi:play-circle" class="text-4xl text-primary opacity-80 transition-opacity group-hover:opacity-100" />
      </div>
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

// 多源 FM 卡（上游语义）：jellyfin/netease 启用即显示；qq/kugou 还需平台已登录
const fmCards = computed(() => {
  const enabled = store.enabledProviders;
  const status = store.authStatus;
  const cards: Array<{ platform: string; title: string; desc: string; icon: string; gradient: string }> = [];
  if (enabled.includes('jellyfin')) {
    cards.push({ platform: 'jellyfin', title: 'Jellyfin 电台', desc: '从收藏出发的 Instant Mix 歌曲流', icon: 'mdi:jellyfish', gradient: 'from-purple-500 to-indigo-500' });
  }
  if (enabled.includes('netease')) {
    cards.push({ platform: 'netease', title: '开启私人FM', desc: '根据你的口味推荐音乐', icon: 'mdi:radio', gradient: 'from-primary to-indigo-500' });
  }
  if (enabled.includes('qq') && status.qq?.loggedIn) {
    cards.push({ platform: 'qq', title: 'QQ 音乐雷达', desc: '猜你喜欢 / 雷达推荐歌曲流', icon: 'mdi:radar', gradient: 'from-emerald-500 to-teal-500' });
  }
  if (enabled.includes('kugou') && status.kugou?.loggedIn) {
    cards.push({ platform: 'kugou', title: '酷狗私人电台', desc: '个性化推荐歌曲流', icon: 'mdi:radio-tower', gradient: 'from-orange-500 to-amber-500' });
  }
  return cards;
});

async function playFm(platform: string) {
  if (!store.activeBotId) {
    toast.error('暂无可用的机器人');
    return;
  }
  // 唤醒后端 POST /api/player/:id/fm：由服务端接管 FM 模式（自动拉歌/续播）
  try {
    const res = await http.post(`/api/player/${store.activeBotId}/fm`, { platform });
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
