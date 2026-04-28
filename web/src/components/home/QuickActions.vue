<template>
  <!-- Search Bar -->
  <div
    class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3 mb-8 cursor-pointer transition-colors hover:bg-interactive-hover"
    @click="$router.push('/search')"
  >
    <Icon icon="mdi:magnify" class="mr-3 text-xl opacity-40" />
    <span class="text-sm opacity-30">搜索歌曲、歌单、专辑...</span>
  </div>

  <!-- FM -->
  <section class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">私人FM</h2>
    <div
      class="flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5 cursor-pointer transition-colors hover:bg-interactive-hover"
      @click="playFm"
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
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { http } from '../../utils/http';
import { usePlayerStore, type Song } from '../../stores/player';

const router = useRouter();
const store = usePlayerStore();

async function playFm() {
  try {
    const res = await http.get('/api/music/personal/fm');
    const songs: Song[] = res.data.songs;
    if (songs.length > 0) {
      await store.play(songs[0].name, songs[0].platform);
      for (let i = 1; i < songs.length; i++) {
        await store.addToQueue(songs[i].name, songs[i].platform);
      }
    }
  } catch { /* ignore */ }
}
</script>
