import { defineStore } from 'pinia';
import { http } from '../utils/http';
import { useToast } from '../composables/useToast';

export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  platform: 'netease' | 'qq' | 'bilibili' | 'youtube';
  /** 播放历史里由谁点歌（仅历史接口返回） */
  requestedBy?: string;
}

export interface BotStatus {
  id: string;
  name: string;
  connected: boolean;
  playing: boolean;
  paused: boolean;
  currentSong: Song | null;
  queueSize: number;
  volume: number;
  playMode: string;
  elapsed?: number;
  /** 试听曲的实际可播时长（秒）；进度条分母与总时长优先用它（B1） */
  effectiveDuration?: number;
}

export interface PlaylistItem {
  id: string;
  name: string;
  coverUrl: string;
  songCount: number;
  platform: string;
}

/** 歌单收藏（/api/favorites）：与歌曲收藏（song-favorites）是两套并存的功能 */
export interface FavoritePlaylist {
  id: number;
  platform: string;
  playlistId: string;
  name: string;
  coverUrl: string;
  songCount: number;
}

interface TimingState {
  serverElapsed: number;
  serverSyncTime: number;
  wasPlaying: boolean;
}

const HOME_CACHE_TTL = 5 * 60 * 1000;

function defaultTiming(): TimingState {
  return { serverElapsed: 0, serverSyncTime: 0, wasPlaying: false };
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    bots: [] as BotStatus[],
    activeBotId: null as string | null,
    /** 专属链接锁定（?bot=）：非空时 UI 锁定单 bot。真源是 URL，不持久化 */
    scopedBotId: null as string | null,
    /** Per-bot queues keyed by botId */
    queues: {} as Record<string, Song[]>,
    /** Per-bot timing state keyed by botId */
    timings: {} as Record<string, TimingState>,
    theme: 'dark' as 'dark' | 'light',

    // Home page cache
    recommendPlaylists: [] as PlaylistItem[],
    dailySongs: [] as Song[],
    userPlaylists: [] as PlaylistItem[],
    bilibiliPopular: [] as Song[],
    lastFetchTime: 0,

    // 歌单收藏（按 WebUI 用户隔离）
    favoritedPlaylists: [] as FavoritePlaylist[],
  }),

  getters: {
    activeBot(): BotStatus | null {
      return this.bots.find((b) => b.id === this.activeBotId) ?? this.bots[0] ?? null;
    },
    /** 专属链接模式下为 true（UI 锁定单 bot，隐藏切换入口） */
    isScoped(): boolean {
      return this.scopedBotId !== null;
    },
    currentSong(): Song | null {
      return this.activeBot?.currentSong ?? null;
    },
    isPlaying(): boolean {
      return this.activeBot?.playing ?? false;
    },
    isPaused(): boolean {
      return this.activeBot?.paused ?? false;
    },
    /** Queue for the currently active bot */
    queue(): Song[] {
      const botId = this.activeBotId ?? this.bots[0]?.id;
      if (!botId) return [];
      return this.queues[botId] ?? [];
    },
    /** Interpolated elapsed for the active bot */
    elapsed(): number {
      const botId = this.activeBotId ?? this.bots[0]?.id;
      if (!botId || !this.activeBot?.currentSong) return 0;
      const timing = this.timings[botId] ?? defaultTiming();
      // 试听曲按 effectiveDuration 钳制（B1）：否则进度条按完整曲长走不完
      const maxDuration =
        (this.activeBot.effectiveDuration ?? this.activeBot.currentSong.duration) || Infinity;
      if (!timing.wasPlaying || timing.serverSyncTime === 0) return Math.min(timing.serverElapsed, maxDuration);
      if (this.isPaused) return Math.min(timing.serverElapsed, maxDuration);
      return Math.min(timing.serverElapsed + (Date.now() - timing.serverSyncTime) / 1000, maxDuration);
    },
  },

  actions: {
    _getTiming(botId: string): TimingState {
      if (!this.timings[botId]) {
        this.timings[botId] = defaultTiming();
      }
      return this.timings[botId];
    },

    _setTiming(botId: string, partial: Partial<TimingState>) {
      const current = this._getTiming(botId);
      this.timings[botId] = { ...current, ...partial };
    },

    /** 切歌类操作的乐观更新：按钮立即转为播放态（进度归零由调用方设置），
     * 不再单靠 WS stateChange 广播修复——广播丢失时轮询也能自愈 */
    _optimisticPlay() {
      const bot = this.bots.find((b) => b.id === this.activeBotId);
      if (bot) {
        bot.playing = true;
        bot.paused = false;
      }
    },

    getQueueForBot(botId: string): Song[] {
      return this.queues[botId] ?? [];
    },

    setActiveBotId(id: string) {
      // 专属链接锁定期间禁止切换到其他 bot
      if (this.scopedBotId !== null && id !== this.scopedBotId) return;
      this.activeBotId = id;
      // Fetch queue for newly active bot if we don't have it yet
      if (!this.queues[id]) {
        this.fetchQueue();
      }
    },

    /** 锁定到单个 bot（专属链接）。先设 scope 再切 active，避免 setActiveBotId 的守卫拦下 */
    setScope(id: string) {
      this.scopedBotId = id;
      this.activeBotId = id;
      if (!this.queues[id]) {
        this.fetchQueue();
      }
    },

    clearScope() {
      this.scopedBotId = null;
    },

    /** 用 URL 的 ?bot= 对账 scope：id 存在则锁定，过期/无权限则清除（绝不锁定到幻影） */
    applyScopeFromQuery(requestedId: string | null) {
      const valid = requestedId && this.bots.some((b) => b.id === requestedId) ? requestedId : null;
      if (valid) {
        this.setScope(valid);
      } else if (requestedId) {
        this.clearScope();
      }
    },

    updateBotStatus(botId: string, status: BotStatus) {
      const prev = this.bots.find((b) => b.id === botId);
      const prevSongId = prev?.currentSong?.id;

      const index = this.bots.findIndex((b) => b.id === botId);
      if (index >= 0) {
        this.bots[index] = status;
      } else {
        this.bots.push(status);
      }

      // Sync elapsed from server status — always per-bot
      if (status.elapsed !== undefined) {
        this._setTiming(botId, {
          serverElapsed: status.elapsed,
          serverSyncTime: Date.now(),
          wasPlaying: status.playing && !status.paused,
        });
      }

      // Song changed — reset timing for this bot
      if (status.currentSong?.id !== prevSongId) {
        this._setTiming(botId, {
          serverElapsed: status.elapsed ?? 0,
          serverSyncTime: Date.now(),
          wasPlaying: status.playing && !status.paused,
        });
      }
    },

    removeBotStatus(botId: string) {
      this.bots = this.bots.filter((b) => b.id !== botId);
      delete this.queues[botId];
      delete this.timings[botId];
      // 锁定的 bot 被移除时解除锁定，避免 UI 锁在幻影上
      if (this.scopedBotId === botId) {
        this.clearScope();
      }
    },

    setQueue(botId: string, queue: Song[]) {
      this.queues[botId] = queue;
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', this.theme);
    },

    loadTheme() {
      const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
      if (saved) this.theme = saved;
    },

    // ── 歌单收藏（D12：/api/favorites 族）──
    async fetchFavoritedPlaylists() {
      try {
        const res = await http.get('/api/favorites');
        this.favoritedPlaylists = res.data.favorites ?? [];
      } catch {
        // 非关键数据，静默失败
      }
    },

    isPlaylistFavorited(playlistId: string, platform: string): boolean {
      return this.favoritedPlaylists.some((f) => f.playlistId === playlistId && f.platform === platform);
    },

    async addPlaylistFavorite(pl: { platform: string; playlistId: string; name: string; coverUrl: string; songCount: number }) {
      const toast = useToast();
      try {
        await http.post('/api/favorites', pl);
        await this.fetchFavoritedPlaylists();
        toast.success('已收藏歌单');
      } catch (err: any) {
        // 409 = 已收藏过（红心状态过期），重新同步即可收敛
        if (err?.response?.status === 409) {
          await this.fetchFavoritedPlaylists();
          return;
        }
        toast.error('收藏失败');
      }
    },

    async removePlaylistFavorite(favId: number) {
      const toast = useToast();
      try {
        await http.delete(`/api/favorites/${favId}`);
        await this.fetchFavoritedPlaylists();
        toast.success('已取消收藏');
      } catch {
        toast.error('取消收藏失败');
      }
    },

    /** 播放 Jellyfin 流派：拉取流派曲目，首曲播放、其余入队 */
    async playJellyfinGenre(genreId: string) {
      const toast = useToast();
      if (!this.activeBotId) return;
      try {
        const res = await http.get(`/api/music/jellyfin/genre/${genreId}/songs`, { params: { limit: 30 } });
        const songs: Song[] = res.data.songs ?? [];
        if (songs.length === 0) {
          toast.error('该流派下没有曲目');
          return;
        }
        await this.playSong(songs[0]);
        for (const song of songs.slice(1)) {
          await this.addSong(song);
        }
        toast.success(`已加入 ${songs.length} 首`);
        this.fetchQueue();
      } catch {
        toast.error('播放流派失败');
      }
    },

    async startBotInstance(id: string) {
      const toast = useToast();
      try {
        await http.post(`/api/bot/${id}/start`);
        toast.success('机器人已启动');
      } catch {
        toast.error('启动机器人失败');
      }
    },

    async stopBotInstance(id: string) {
      const toast = useToast();
      try {
        await http.post(`/api/bot/${id}/stop`);
        toast.success('机器人已停止');
      } catch {
        toast.error('停止机器人失败');
      }
    },

    async fetchBots() {
      try {
        const res = await http.get('/api/bot');
        const fetchedBots: BotStatus[] = res.data.bots ?? [];

        // Merge fetched bots into store instead of wholesale replacement
        // to avoid racing with WebSocket init/stateChange updates
        for (const bot of fetchedBots) {
          this.updateBotStatus(bot.id, bot);
        }

        // Remove bots that no longer exist on the server
        const aliveIds = new Set(fetchedBots.map((b) => b.id));
        for (const bot of [...this.bots]) {
          if (!aliveIds.has(bot.id)) {
            this.removeBotStatus(bot.id);
          }
        }

        if (!this.activeBotId && this.bots.length > 0) {
          this.activeBotId = this.bots[0].id;
          await this.fetchQueue();
        }
      } catch (err) {
        console.debug('fetchBots failed:', err);
      }
    },

    /** Poll server for real elapsed time and playback state for active bot */
    async syncElapsed() {
      if (!this.activeBotId || (this as any)._syncingElapsed) return;
      (this as any)._syncingElapsed = true;
      try {
        const res = await http.get(`/api/player/${this.activeBotId}/elapsed`);
        const bot = this.bots.find((b) => b.id === this.activeBotId);
        if (bot) {
          bot.playing = res.data.playing ?? bot.playing;
          bot.paused = res.data.paused ?? bot.paused;
          if (typeof res.data.volume === 'number') bot.volume = res.data.volume;
          if (res.data.playMode) bot.playMode = res.data.playMode;
          if (typeof res.data.effectiveDuration === 'number') bot.effectiveDuration = res.data.effectiveDuration;
        }
        this._setTiming(this.activeBotId, {
          serverElapsed: res.data.elapsed,
          serverSyncTime: Date.now(),
          wasPlaying: res.data.playing && !res.data.paused,
        });
      } catch (err) {
        console.debug('syncElapsed failed:', err);
      } finally {
        (this as any)._syncingElapsed = false;
      }
    },

    async fetchQueue() {
      if (!this.activeBotId) return;
      try {
        const res = await http.get(`/api/player/${this.activeBotId}/queue`);
        this.queues[this.activeBotId] = res.data.queue ?? [];
      } catch (err) {
        console.debug('fetchQueue failed:', err);
      }
    },

    async fetchQueueForBot(botId: string) {
      try {
        const res = await http.get(`/api/player/${botId}/queue`);
        this.queues[botId] = res.data.queue ?? [];
      } catch (err) {
        console.debug('fetchQueueForBot failed:', err);
      }
    },

    async reorderQueue(fromIndex: number, toIndex: number) {
      if (!this.activeBotId) return;
      try {
        await http.post(`/api/player/${this.activeBotId}/queue/reorder`, { fromIndex, toIndex });
        await this.fetchQueue();
      } catch (err) {
        console.error('Queue reorder failed:', err);
      }
    },

    _syncAfterAction() {
      if (!this.activeBotId) return;
      this._setTiming(this.activeBotId, {
        serverSyncTime: Date.now(),
        wasPlaying: true,
      });
      // Sync from server after a short delay for accuracy
      setTimeout(() => this.syncElapsed(), 500);
    },

    async playAtIndex(index: number) {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
      await http.post(`/api/player/${this.activeBotId}/play-at`, { index });
      this._optimisticPlay();
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
        this._syncAfterAction();
        toast.success('开始播放');
      } catch {
        toast.error('播放失败');
      }
    },

    async play(query: string, platform = 'netease') {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
      await http.post(`/api/player/${this.activeBotId}/play`, { query, platform });
      this._optimisticPlay();
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
        this._syncAfterAction();
        toast.success('开始播放');
      } catch {
        toast.error('播放失败');
      }
    },

    async playSong(song: Song) {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
      await http.post(`/api/player/${this.activeBotId}/play-song`, { song });
      this._optimisticPlay();
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
        this._syncAfterAction();
        toast.success(`开始播放: ${song.name}`);
      } catch {
        toast.error('播放失败');
      }
    },

    async addToQueue(query: string, platform = 'netease') {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
        await http.post(`/api/player/${this.activeBotId}/add`, { query, platform });
        await this.fetchQueue();
        toast.success('已添加到队列');
      } catch {
        toast.error('添加到队列失败');
      }
    },

    async addSong(song: Song) {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
        await http.post(`/api/player/${this.activeBotId}/add-song`, { song });
        await this.fetchQueue();
        toast.success(`已添加到队列: ${song.name}`);
      } catch {
        toast.error('添加到队列失败');
      }
    },

    /** 下一首播放：插入到当前曲目之后，不打断当前播放、不清空队列 */
    async playNextSong(song: Song) {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
        await http.post(`/api/player/${this.activeBotId}/play-next-song`, { song });
        await this.fetchQueue();
        toast.success(`下一首播放: ${song.name}`);
      } catch {
        toast.error('下一首播放失败');
      }
    },

    async playPlaylist(playlistId: string, platform = 'netease') {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
      await http.post(`/api/player/${this.activeBotId}/play-playlist`, { playlistId, platform });
      this._optimisticPlay();
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
        this._syncAfterAction();
        toast.success('开始播放歌单');
      } catch {
        toast.error('播放歌单失败');
      }
    },

    async pause() {
      if (!this.activeBotId) return;
      // Optimistically update local state for instant UI feedback
      const bot = this.bots.find((b) => b.id === this.activeBotId);
      if (bot) {
        bot.playing = false;
        bot.paused = true;
      }
      // Freeze elapsed at current interpolated value
      this._setTiming(this.activeBotId, {
        serverElapsed: this.elapsed,
        wasPlaying: false,
      });
      await http.post(`/api/player/${this.activeBotId}/pause`);
    },

    async resume() {
      if (!this.activeBotId) return;
      // Optimistically update local state for instant UI feedback
      const bot = this.bots.find((b) => b.id === this.activeBotId);
      if (bot) {
        bot.playing = true;
        bot.paused = false;
      }
      await http.post(`/api/player/${this.activeBotId}/resume`);
      this._setTiming(this.activeBotId, {
        serverSyncTime: Date.now(),
        wasPlaying: true,
      });
      setTimeout(() => this.syncElapsed(), 300);
    },

    async next() {
      if (!this.activeBotId) return;
      this._optimisticPlay();
      await http.post(`/api/player/${this.activeBotId}/next`);
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
      this._syncAfterAction();
    },

    async prev() {
      if (!this.activeBotId) return;
      this._optimisticPlay();
      await http.post(`/api/player/${this.activeBotId}/prev`);
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
      this._syncAfterAction();
    },

    async stop() {
      if (!this.activeBotId) return;
      await http.post(`/api/player/${this.activeBotId}/stop`);
      this._setTiming(this.activeBotId, {
        serverElapsed: 0,
        serverSyncTime: 0,
        wasPlaying: false,
      });
    },

    async seek(position: number) {
      if (!this.activeBotId) return;
      // 立即更新本地状态，不等 HTTP 响应
      this._setTiming(this.activeBotId, {
        serverElapsed: position,
        serverSyncTime: Date.now(),
        wasPlaying: true,
      });
      const bot = this.bots.find(b => b.id === this.activeBotId);
      if (bot) {
        bot.playing = true;
        bot.paused = false;
      }
      // 再发请求到服务端
      await http.post(`/api/player/${this.activeBotId}/seek`, { position });
      this._syncAfterAction();
    },

    async setVolume(volume: number) {
      if (!this.activeBotId) return;
      await http.post(`/api/player/${this.activeBotId}/volume`, { volume });
    },

    async setMode(mode: string) {
      if (!this.activeBotId) return;
      const toast = useToast();
      const modeLabels: Record<string, string> = {
        seq: '顺序播放',
        loop: '单曲循环',
        random: '随机播放',
        rloop: '随机循环',
      };
      try {
        await http.post(`/api/player/${this.activeBotId}/mode`, { mode });
        toast.success(`已切换到${modeLabels[mode] ?? mode}`);
      } catch {
        toast.error('切换播放模式失败');
      }
    },

    async fetchHomeData() {
      if (this.lastFetchTime > 0 && Date.now() - this.lastFetchTime < HOME_CACHE_TTL) {
        return;
      }

      const [playlistRes, dailyRes, userRes, biliRes] = await Promise.allSettled([
        http.get('/api/music/recommend/playlists'),
        http.get('/api/music/recommend/songs'),
        http.get('/api/music/user/playlists'),
        http.get('/api/music/bilibili/popular?limit=12'),
      ]);

      if (playlistRes.status === 'fulfilled') {
        this.recommendPlaylists = playlistRes.value.data.playlists;
      }
      if (dailyRes.status === 'fulfilled') {
        this.dailySongs = dailyRes.value.data.songs;
      }
      if (userRes.status === 'fulfilled') {
        this.userPlaylists = userRes.value.data.playlists;
      }
      if (biliRes.status === 'fulfilled') {
        this.bilibiliPopular = biliRes.value.data.songs;
      }

      const anySuccess =
        playlistRes.status === 'fulfilled' ||
        dailyRes.status === 'fulfilled' ||
        userRes.status === 'fulfilled' ||
        biliRes.status === 'fulfilled';
      if (anySuccess) {
        this.lastFetchTime = Date.now();
      }
    },
  },
});
