<template>
  <div class="p-6">
    <button class="flex items-center gap-1.5 text-sm opacity-70 mb-4 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <div v-if="loading" class="text-center py-[60px] text-text-secondary">加载中...</div>

    <template v-else-if="artist">
      <!-- Hero：圆形头像 + 平台 / 名字 / 别名 / 统计 / 简介 / 操作（上游 Apple Music 式布局） -->
      <div class="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8 mb-9">
        <div class="w-32 sm:w-44 aspect-square shrink-0 rounded-full overflow-hidden">
          <CoverArt v-if="artist.avatarUrl" :url="artist.avatarUrl" fill :radius="999" :show-shadow="true" />
          <div v-else class="w-full h-full flex items-center justify-center bg-surface-card text-text-tertiary">
            <Icon icon="mdi:account-music" class="text-[64px]" />
          </div>
        </div>
        <div class="flex flex-col justify-center min-w-0">
          <div class="text-xs font-semibold tracking-widest uppercase text-primary mb-1.5">{{ platformLabel }}</div>
          <h1 class="text-[28px] sm:text-[32px] font-extrabold mb-1.5 truncate">{{ artist.name }}</h1>
          <div v-if="artist.aliases?.length" class="text-[13px] text-text-secondary mb-2">{{ artist.aliases.join(' / ') }}</div>
          <div class="flex flex-wrap gap-3 text-xs text-text-tertiary mb-3">
            <span v-if="hotSongs.length">热门歌曲 {{ hotSongs.length }} 首</span>
            <span v-if="albums.length">专辑 {{ albums.length }} 张</span>
            <span v-if="artist.songCount">共 {{ artist.songCount }} 首歌</span>
          </div>
          <p v-if="artist.description" class="text-[13px] text-text-secondary mb-4 max-w-[640px] line-clamp-3">{{ artist.description }}</p>
          <div v-if="canPlayAll" class="flex flex-wrap items-center gap-3">
            <button
              class="flex items-center gap-1.5 px-7 py-2.5 bg-primary text-white rounded-[var(--radius-lg)] text-sm font-semibold transition-transform hover:scale-[1.04] active:scale-[0.96]"
              title="播放该歌手的全部歌曲"
              @click="playAll"
            >
              <Icon icon="mdi:play" />
              播放全部
            </button>
            <button
              v-if="canShuffle"
              class="flex items-center gap-1.5 px-5 py-2.5 rounded-[var(--radius-lg)] border border-border-color text-text-secondary text-sm font-semibold transition-colors hover:text-primary hover:border-primary hover:bg-primary/10"
              title="随机播放该歌手的全部歌曲"
              @click="shuffleAll"
            >
              <Icon icon="mdi:shuffle" />
              随机播放
            </button>
          </div>
        </div>
      </div>

      <!-- 热门歌曲：先展示前 10 首，其余折叠（接口最多返回 50 首） -->
      <section v-if="hotSongs.length" class="mb-8">
        <h2 class="text-lg font-bold mb-3">热门歌曲</h2>
        <div class="flex flex-col gap-0.5">
          <SongCard
            v-for="(song, i) in visibleSongs"
            :key="song.id"
            :song="song"
            :index="i + 1"
            :active="store.currentSong?.id === song.id"
            @play="store.playSong(song)"
            @playnext="store.playNextSong(song)"
            @add="store.addSong(song)"
          />
        </div>
        <button
          v-if="hotSongs.length > visibleCount"
          class="mt-3 px-4 py-2 text-[13px] text-text-secondary rounded-[var(--radius-md)] border border-border-color transition-colors hover:text-primary hover:border-primary"
          @click="expanded = true"
        >
          显示全部 {{ hotSongs.length }} 首
        </button>
      </section>

      <!-- 专辑：横向滚动行；固定卡片宽 + aspect-square 外壳（响应式封面约定） -->
      <section v-if="albums.length" class="mb-8">
        <h2 class="text-lg font-bold mb-3">专辑</h2>
        <div class="flex gap-4 overflow-x-auto pb-2">
          <router-link
            v-for="al in albums"
            :key="`${al.platform}-${al.id}`"
            :to="`/album/${al.id}?platform=${al.platform}`"
            class="w-[150px] shrink-0"
            :title="`打开专辑：${al.name}`"
          >
            <div class="aspect-square">
              <CoverArt :url="al.coverUrl" fill :radius="10" :show-shadow="true" />
            </div>
            <div class="mt-2 text-[13px] font-semibold line-clamp-2">{{ al.name }}</div>
            <div v-if="al.songCount" class="text-xs text-text-tertiary">{{ al.songCount }} 首</div>
          </router-link>
        </div>
      </section>
    </template>

    <div v-else class="text-center py-[60px]">
      <Icon icon="mdi:account-music-outline" class="text-4xl text-text-tertiary mb-3" />
      <p class="text-text-secondary text-sm">歌手不存在或加载失败</p>
      <button class="mt-4 px-5 py-2 text-sm font-medium rounded-[var(--radius-md)] bg-primary text-white cursor-pointer transition-colors hover:brightness-110" @click="loadArtist">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type Song } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';
import { getProviderLabel } from '../utils/platform';
import CoverArt from '../components/CoverArt.vue';
import SongCard from '../components/SongCard.vue';

interface ArtistDetail {
  id: string;
  name: string;
  avatarUrl: string;
  aliases?: string[];
  songCount?: number;
  albumCount?: number;
  platform: string;
  description?: string;
}

interface ArtistAlbum {
  id: string;
  name: string;
  artist?: string;
  coverUrl: string;
  songCount?: number;
  platform: string;
}

/** 展开「显示全部」前展示的热门歌曲数 */
const HOT_SONG_PREVIEW = 10;

const store = usePlayerStore();
const auth = useAuthStore();
const route = useRoute();

// 播放全部对齐后端 play-artist 授权（player.control / 游客 playCollection）；
// 随机播放先切 random 模式，因此还要 playMode（与后端 /mode 授权同口径）
const canPlayAll = computed(() => auth.can('player.control') || auth.guestCan('playCollection'));
const canShuffle = computed(
  () => canPlayAll.value && (auth.can('player.control') || auth.guestCan('playMode')),
);

const artist = ref<ArtistDetail | null>(null);
const hotSongs = ref<Song[]>([]);
const albums = ref<ArtistAlbum[]>([]);
const loading = ref(true);
const expanded = ref(false);
// 迟到请求守卫：RouterView 复用组件（仅参数变化）时，艺人 → 艺人导航的
// 旧响应不得覆盖新页面
let artistRequest = 0;

const platform = computed(() => (route.query.platform as string) || 'netease');
const platformLabel = computed(() => getProviderLabel(platform.value));

const visibleCount = computed(() =>
  expanded.value ? hotSongs.value.length : Math.min(HOT_SONG_PREVIEW, hotSongs.value.length),
);
const visibleSongs = computed(() => hotSongs.value.slice(0, visibleCount.value));

function playAll() {
  // 后端入队的是歌手全目录，不只是热门 50
  store.playArtist(artistId(), platform.value);
}

async function shuffleAll() {
  if (!canShuffle.value) return;
  // 复用队列自身的随机模式（与播放器工具栏同一开关）。fork 的 setMode
  // 自吞错误并 toast；按钮可见即代表权限已过同款门控，失败仅偶发于网络
  // 异常，继续入队优于静默不动。
  await store.setMode('random');
  await store.playArtist(artistId(), platform.value);
}

function artistId(): string {
  return route.params.id as string;
}

async function loadArtist() {
  const request = ++artistRequest;
  loading.value = true;
  // 每个艺人维度的状态全部重置：组件被路由参数复用时不得残留上一个艺人的行
  artist.value = null;
  hotSongs.value = [];
  albums.value = [];
  expanded.value = false;
  try {
    const res = await http.get(`/api/music/artist/${artistId()}`, {
      params: { platform: platform.value },
    });
    if (request !== artistRequest) return;
    artist.value = res.data?.artist ?? null;
    hotSongs.value = res.data?.songs ?? [];
    albums.value = res.data?.albums ?? [];
  } catch {
    if (request !== artistRequest) return;
    artist.value = null;
  } finally {
    if (request === artistRequest) loading.value = false;
  }
}

onMounted(loadArtist);
watch(() => `${route.params.id}|${route.query.platform ?? ''}`, loadArtist);
</script>

<style scoped>
/* 跳出视口的行不参与渲染/布局（无虚拟化列表的低成本替代，同 Playlist.vue） */
.flex.flex-col > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 64px;
}
</style>
