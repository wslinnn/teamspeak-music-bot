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
}

export interface PlaylistItem {
  id: string;
  name: string;
  coverUrl: string;
  songCount: number;
  platform: string;
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
  }),

  getters: {
    activeBot(): BotStatus | null {
      return this.bots.find((b) => b.id === this.activeBotId) ?? this.bots[0] ?? null;
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
      const maxDuration = this.activeBot.currentSong.duration || Infinity;
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

    getQueueForBot(botId: string): Song[] {
      return this.queues[botId] ?? [];
    },

    setActiveBotId(id: string) {
      this.activeBotId = id;
      // Fetch queue for newly active bot if we don't have it yet
      if (!this.queues[id]) {
        this.fetchQueue();
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
      const res = await http.get('/api/bot');
      this.bots = res.data.bots;
      if (!this.activeBotId && this.bots.length > 0) {
        this.activeBotId = this.bots[0].id;
        await this.fetchQueue();
      }
      // Sync elapsed from each bot's status
      for (const bot of this.bots) {
        if (bot.elapsed !== undefined) {
          this._setTiming(bot.id, {
            serverElapsed: bot.elapsed,
            serverSyncTime: Date.now(),
            wasPlaying: bot.playing && !bot.paused,
          });
        }
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

    async playPlaylist(playlistId: string, platform = 'netease') {
      if (!this.activeBotId) return;
      const toast = useToast();
      try {
        await http.post(`/api/player/${this.activeBotId}/play-playlist`, { playlistId, platform });
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
      await http.post(`/api/player/${this.activeBotId}/next`);
      this._setTiming(this.activeBotId, { serverElapsed: 0 });
      this._syncAfterAction();
    },

    async prev() {
      if (!this.activeBotId) return;
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
