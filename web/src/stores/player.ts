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
  /** 由谁点歌（TS 聊天取发言者昵称，WebUI 取用户名；历史与队列接口均返回） */
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
  /** 私人 FM 运行中时为 FM 音源标识，否则为空串 */
  fmPlatform?: string;
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

export interface TimingState {
  serverElapsed: number;
  serverSyncTime: number;
  wasPlaying: boolean;
}

const HOME_CACHE_TTL = 5 * 60 * 1000;

function defaultTiming(): TimingState {
  return { serverElapsed: 0, serverSyncTime: 0, wasPlaying: false };
}

/** 从最后一次服务器锚点插值出当前播放进度。纯函数：唯一时间源是 Date.now()。
 *  刻意不放进 Pinia getter——getter 是 computed，缓存只在响应式依赖变化时失效，
 *  而 Date.now() 不是响应式依赖，rAF/interval 循环直接读 getter 会在两次服务器
 *  推送之间拿到冻结值，时钟呈台阶状跳变（上游 issue #107）。
 *  逐帧消费方（进度条/歌词同步）必须经由 liveElapsed() action 调用。 */
export function interpolateElapsed(
  timing: TimingState,
  isPaused: boolean,
  maxDuration: number,
): number {
  if (!timing.wasPlaying || timing.serverSyncTime === 0 || isPaused) {
    return Math.min(timing.serverElapsed, maxDuration);
  }
  return Math.min(timing.serverElapsed + (Date.now() - timing.serverSyncTime) / 1000, maxDuration);
}

/**
 * 审计 PERF-10：/api/music/providers 的共享缓存（见 fetchEnabledProviders）。
 */
let providersCache: { at: number; promise: Promise<string[]> } | null = null;

export const usePlayerStore = defineStore('player', {
  state: () => ({
    bots: [] as BotStatus[],
    activeBotId: null as string | null,
    /** 专属链接锁定（?bot=）：非空时 UI 锁定单 bot。真源是 URL，不持久化 */
    scopedBotId: null as string | null,
    /** Per-bot queues keyed by botId */
    queues: {} as Record<string, Song[]>,
    /** 每个 bot 正在播放的歌在队列中的下标（-1 = 未开播；与 queues 同次快照） */
    queueCurrentIndex: {} as Record<string, number>,
    /** Per-bot timing state keyed by botId */
    timings: {} as Record<string, TimingState>,
    theme: 'auto' as 'auto' | 'dark' | 'light',
    /** 系统深浅色偏好（AUTO 主题的解析依据），loadTheme 时初始化并持续监听 */
    systemPrefersDark: false,

    // Home page cache
    recommendPlaylists: [] as PlaylistItem[],
    dailySongs: [] as Song[],
    userPlaylists: [] as PlaylistItem[],
    bilibiliPopular: [] as Song[],
    lastFetchTime: 0,

    // 歌单收藏（按 WebUI 用户隔离）
    favoritedPlaylists: [] as FavoritePlaylist[],

    // 已存清单功能开关（GET /api/bot/settings；控制 Queue 抽屉的清单按钮显隐）
    savedQueuesEnabled: false,
    /** 本地音视频上传播放开关（GET /api/bot/settings；默认视为关闭，搜索页据此显隐上传卡） */
    localAudioEnabled: false,

    // 音源启用状态（GET /api/music/providers）与平台登录态（GET /api/auth/status），
    // 供首页推荐/FM 多源切换与各处显隐使用
    enabledProviders: [] as string[],
    authStatus: {} as Record<string, { loggedIn: boolean; nickname: string }>,
  }),

  getters: {
    activeBot(): BotStatus | null {
      return this.bots.find((b) => b.id === this.activeBotId) ?? this.bots[0] ?? null;
    },
    /** 专属链接模式下为 true（UI 锁定单 bot，隐藏切换入口） */
    isScoped(): boolean {
      return this.scopedBotId !== null;
    },
    /** AUTO 主题的实际解析结果：显式选择原样返回，AUTO 跟随系统深浅色 */
    resolvedTheme(): 'dark' | 'light' {
      if (this.theme !== 'auto') return this.theme;
      return this.systemPrefersDark ? 'dark' : 'light';
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
    /** Interpolated elapsed for the active bot（一次性响应式读；逐帧消费用 liveElapsed） */
    elapsed(): number {
      const botId = this.activeBotId ?? this.bots[0]?.id;
      if (!botId || !this.activeBot?.currentSong) return 0;
      const timing = this.timings[botId] ?? defaultTiming();
      const maxDuration =
        (this.activeBot.effectiveDuration ?? this.activeBot.currentSong.duration) || Infinity;
      return interpolateElapsed(timing, this.isPaused, maxDuration);
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
      // 顶栏按钮三态循环：浅色 → 深色 → 跟随系统 → 浅色
      const order: Array<'light' | 'dark' | 'auto'> = ['light', 'dark', 'auto'];
      const idx = order.indexOf(this.theme);
      this.setTheme(order[(idx + 1) % order.length]);
    },

    setTheme(theme: 'auto' | 'dark' | 'light') {
      this.theme = theme;
      localStorage.setItem('theme', theme);
    },

    loadTheme() {
      const saved = localStorage.getItem('theme') as 'auto' | 'dark' | 'light' | null;
      // 未保存过偏好（全新用户）默认跟随系统；已保存的显式选择不受影响
      this.theme = saved ?? 'auto';
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        this.systemPrefersDark = mq.matches;
        mq.addEventListener('change', (e) => {
          this.systemPrefersDark = e.matches;
        });
      }
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

    /** 拉取 bot 全局设置里的功能开关（savedQueuesEnabled / localAudioEnabled） */
    async fetchBotSettings() {
      try {
        const res = await http.get('/api/bot/settings');
        this.savedQueuesEnabled = res.data?.savedQueuesEnabled === true;
        this.localAudioEnabled = res.data?.localAudioEnabled === true;
      } catch {
        // 拉不到保持默认（隐藏），后端禁用时清单接口本就 403
      }
    },

    /**
     * 审计 PERF-10：providers 列表低频变化，但 Search/Library/JellyfinSections
     * 各自挂载时都会拉一份。这里做模块级共享缓存（60s TTL、在途共享、
     * 失败不缓存），组件统一走本 action 并拿到返回值。
     */
    async fetchEnabledProviders(): Promise<string[]> {
      if (providersCache && Date.now() - providersCache.at < 60_000) {
        this.enabledProviders = await providersCache.promise;
        return this.enabledProviders;
      }
      providersCache = null;
      const promise = http
        .get('/api/music/providers')
        .then((res) => {
          const enabled: string[] = res.data.enabled ?? [];
          providersCache = { at: Date.now(), promise: Promise.resolve(enabled) };
          return enabled;
        })
        .catch(() => [] as string[]); // 失败不缓存：下次进入页面重试
      this.enabledProviders = await promise;
      return this.enabledProviders;
    },

    /** 平台登录态（netease/qq/kugou）；游客无权访问，保持空 */
    async fetchAuthStatus() {
      const platforms = ['netease', 'qq', 'kugou'];
      const results = await Promise.allSettled(
        platforms.map((p) => http.get('/api/auth/status', { params: { platform: p } })),
      );
      const next: Record<string, { loggedIn: boolean; nickname: string }> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          next[platforms[i]] = {
            loggedIn: r.value.data?.loggedIn === true,
            nickname: r.value.data?.nickname ?? '',
          };
        }
      });
      this.authStatus = next;
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
          // PERF-08：静默入队，整批只在最后刷一次队列
          await this.addSongSilent(song);
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

    /** Live elapsed seconds for the active bot。与 elapsed getter 的区别：action
     *  不被缓存，每次调用都重新插值——进度条/歌词等 rAF/interval 消费方必须用它，
     *  否则时钟在两次服务器推送之间冻结（上游 issue #107）。 */
    liveElapsed(): number {
      const botId = this.activeBotId ?? this.bots[0]?.id;
      if (!botId || !this.activeBot?.currentSong) return 0;
      const timing = this.timings[botId] ?? defaultTiming();
      // 试听曲按 effectiveDuration 钳制（B1）：否则进度条按完整曲长走不完
      const maxDuration =
        (this.activeBot.effectiveDuration ?? this.activeBot.currentSong.duration) || Infinity;
      return interpolateElapsed(timing, this.isPaused, maxDuration);
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
        this.queueCurrentIndex[this.activeBotId] =
          typeof res.data.currentIndex === 'number' ? res.data.currentIndex : -1;
      } catch (err) {
        console.debug('fetchQueue failed:', err);
      }
    },

    async fetchQueueForBot(botId: string) {
      try {
        const res = await http.get(`/api/player/${botId}/queue`);
        this.queues[botId] = res.data.queue ?? [];
        this.queueCurrentIndex[botId] =
          typeof res.data.currentIndex === 'number' ? res.data.currentIndex : -1;
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

    /** 审计 PERF-08：批量入队用的静默版——不逐首拉队列、不逐首弹 toast，
     *  由调用方在整批结束后统一 fetchQueue() 一次。返回是否成功。 */
    async addSongSilent(song: Song): Promise<boolean> {
      if (!this.activeBotId) return false;
      try {
        await http.post(`/api/player/${this.activeBotId}/add-song`, { song });
        return true;
      } catch {
        return false;
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

    async playAlbum(albumId: string, platform = 'netease') {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
        await http.post(`/api/player/${this.activeBotId}/play-album`, { albumId, platform });
        this._optimisticPlay();
        this._setTiming(this.activeBotId, { serverElapsed: 0 });
        this._syncAfterAction();
        toast.success('开始播放专辑');
      } catch {
        toast.error('播放专辑失败');
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
      try {
        await http.post(`/api/player/${this.activeBotId}/seek`, { position });
        this._syncAfterAction();
      } catch {
        // 服务端拒绝（权限/离线）时撤销乐观锚点，恢复最近一次服务器时钟；
        // 错误提示由 http 拦截器统一弹出
        await this.syncElapsed().catch(() => {});
      }
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
        loop: '列表循环',
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

    /** 退出私人 FM：停止自动续播，队列按顺序继续（状态由 WS 推送更新） */
    async stopFm() {
      if (!this.activeBotId) return;
      await http.post(`/api/player/${this.activeBotId}/fm/stop`);
    },

    /** 清空即将播放的歌曲，播完当前为止（与 stop/clear 的全停语义相区分） */
    async clearUpcoming() {
      if (!this.activeBotId) return;
      await http.post(`/api/player/${this.activeBotId}/queue/clear-upcoming`);
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
