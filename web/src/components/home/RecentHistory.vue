<template>
  <!-- Daily Songs -->
  <section v-if="store.dailySongs.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">每日推荐</h2>
    <div class="grid grid-cols-3 gap-5 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="song in store.dailySongs.slice(0, 12)"
        :key="song.id"
        class="cursor-pointer hover-scale"
        @click="store.playSong(song)"
      >
        <CoverArt :url="song.coverUrl" :size="120" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
        <div class="text-xs text-foreground-muted truncate">{{ song.artist }}</div>
      </div>
    </div>
  </section>

  <!-- Recommend Playlists -->
  <section v-if="store.recommendPlaylists.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">推荐歌单</h2>
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <RouterLink
        v-for="playlist in store.recommendPlaylists"
        :key="playlist.id"
        :to="`/playlist/${playlist.id}?platform=${playlist.platform}`"
        class="block cursor-pointer text-inherit no-underline hover-scale"
      >
        <CoverArt :url="playlist.coverUrl" :size="160" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium line-clamp-2">{{ playlist.name }}</div>
      </RouterLink>
    </div>
  </section>

  <!-- User Playlists -->
  <section v-if="store.userPlaylists.length > 0" class="mb-9">
    <h2 class="mb-4 flex items-center gap-2 text-[22px] font-bold">
      我的歌单
      <span class="text-[13px] font-medium text-foreground-subtle">{{ store.userPlaylists.length }}</span>
    </h2>
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <RouterLink
        v-for="pl in visibleUserPlaylists"
        :key="pl.id"
        :to="`/playlist/${pl.id}?platform=${pl.platform}`"
        class="block cursor-pointer text-inherit no-underline hover-scale"
      >
        <CoverArt :url="pl.coverUrl" :size="160" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium line-clamp-2">{{ pl.name }}</div>
        <div class="mt-0.5 text-xs text-foreground-subtle">{{ pl.songCount }} 首</div>
      </RouterLink>
    </div>
    <button
      v-if="store.userPlaylists.length > USER_PLAYLIST_LIMIT"
      class="mt-3 flex w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-surface-card py-2.5 text-[13px] font-medium text-foreground-muted transition-colors hover:bg-interactive-hover hover:text-primary"
      @click="userPlaylistsExpanded = !userPlaylistsExpanded"
    >
      <Icon :icon="userPlaylistsExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'" />
      {{ userPlaylistsExpanded ? '收起' : `展开全部 ${store.userPlaylists.length} 个歌单` }}
    </button>
  </section>

  <!-- Bilibili Popular -->
  <section v-if="store.bilibiliPopular.length > 0" class="mb-9">
    <h2 class="mb-4 flex items-center gap-2 text-[22px] font-bold">
      <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-[#00a1d6] text-sm font-extrabold text-white">B</span>
      B站热门
    </h2>
    <div class="grid grid-cols-3 gap-5 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="song in store.bilibiliPopular.slice(0, 12)"
        :key="song.id"
        class="cursor-pointer hover-scale"
        @click="store.playSong(song)"
      >
        <CoverArt :url="song.coverUrl" :size="120" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
        <div class="text-xs text-foreground-muted truncate">{{ song.artist }}</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player';
import CoverArt from '../CoverArt.vue';

const store = usePlayerStore();
const USER_PLAYLIST_LIMIT = 20;
const userPlaylistsExpanded = ref(false);

const visibleUserPlaylists = computed(() =>
  userPlaylistsExpanded.value
    ? store.userPlaylists
    : store.userPlaylists.slice(0, USER_PLAYLIST_LIMIT)
);
</script>
