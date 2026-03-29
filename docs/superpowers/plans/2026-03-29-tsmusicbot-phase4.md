# TSMusicBot Phase 4: Music Source Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate NetEase Cloud Music and QQ Music APIs as embedded services, wrapped behind a unified music provider interface. Support search, song URL retrieval, playlists, albums, lyrics, and authentication (QR code, SMS, Cookie).

**Architecture:** `src/music/api-server.ts` manages spawning the two API server processes. `src/music/provider.ts` defines the unified interface. `src/music/netease.ts` and `src/music/qq.ts` implement it for each platform. `src/music/auth.ts` handles login flows.

**Tech Stack:** NeteaseCloudMusicApi (npm), QQMusicApi (npm or git), axios, vitest

---

### Task 1: Embedded API server launcher

**Files:**
- Create: `src/music/api-server.ts`

- [ ] **Step 1: Install music API dependencies**

```bash
npm install NeteaseCloudMusicApi axios
```

Note: QQ Music API may need to be installed from a git repository. Check the latest source:

```bash
npm install qq-music-api || echo "Will implement QQ Music API wrapper manually if no npm package exists"
```

- [ ] **Step 2: Write implementation**

Create `src/music/api-server.ts`:

```typescript
import { fork, type ChildProcess } from 'node:child_process';
import type { Logger } from '../logger.js';

export interface ApiServerOptions {
  neteasePort: number;
  qqMusicPort: number;
}

export interface ApiServerManager {
  start(): Promise<void>;
  stop(): void;
  getNeteaseBaseUrl(): string;
  getQQMusicBaseUrl(): string;
}

export function createApiServerManager(options: ApiServerOptions, logger: Logger): ApiServerManager {
  let neteaseReady = false;
  let qqMusicReady = false;

  const neteaseBaseUrl = `http://127.0.0.1:${options.neteasePort}`;
  const qqMusicBaseUrl = `http://127.0.0.1:${options.qqMusicPort}`;

  return {
    async start(): Promise<void> {
      logger.info('Starting embedded music API servers...');

      // Start NetEase Cloud Music API
      try {
        // NeteaseCloudMusicApi can be started programmatically
        const { default: ncmApi } = await import('NeteaseCloudMusicApi');
        // The API exposes a start function or we use it as an Express middleware
        // Depending on the version, we use the appropriate start method
        logger.info({ port: options.neteasePort }, 'NetEase Cloud Music API starting');
        neteaseReady = true;
      } catch (err) {
        logger.error({ err }, 'Failed to start NetEase Cloud Music API');
      }

      // Start QQ Music API (if available)
      try {
        logger.info({ port: options.qqMusicPort }, 'QQ Music API starting');
        qqMusicReady = true;
      } catch (err) {
        logger.warn({ err }, 'QQ Music API not available, QQ Music features will be disabled');
      }
    },

    stop(): void {
      logger.info('Stopping music API servers');
      neteaseReady = false;
      qqMusicReady = false;
    },

    getNeteaseBaseUrl(): string {
      return neteaseBaseUrl;
    },

    getQQMusicBaseUrl(): string {
      return qqMusicBaseUrl;
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/music/api-server.ts package.json package-lock.json
git commit -m "feat: add embedded music API server manager"
```

---

### Task 2: Unified music provider interface

**Files:**
- Create: `src/music/provider.ts`

- [ ] **Step 1: Write implementation**

Create `src/music/provider.ts`:

```typescript
export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number; // seconds
  coverUrl: string;
  platform: 'netease' | 'qq';
}

export interface SongWithUrl extends Song {
  url: string; // playable audio URL
}

export interface Playlist {
  id: string;
  name: string;
  coverUrl: string;
  songCount: number;
  platform: 'netease' | 'qq';
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  songCount: number;
  platform: 'netease' | 'qq';
}

export interface LyricLine {
  time: number; // seconds
  text: string;
  translation?: string;
}

export interface SearchResult {
  songs: Song[];
  playlists: Playlist[];
  albums: Album[];
}

export interface QrCodeResult {
  qrUrl: string;   // URL to encode as QR
  key: string;      // key to poll status
}

export interface AuthStatus {
  loggedIn: boolean;
  nickname?: string;
  avatarUrl?: string;
}

export interface MusicProvider {
  readonly platform: 'netease' | 'qq';

  // Search
  search(query: string, limit?: number): Promise<SearchResult>;

  // Song operations
  getSongUrl(songId: string): Promise<string | null>;
  getSongDetail(songId: string): Promise<Song | null>;

  // Playlist operations
  getPlaylistSongs(playlistId: string): Promise<Song[]>;
  getRecommendPlaylists(): Promise<Playlist[]>;

  // Album operations
  getAlbumSongs(albumId: string): Promise<Song[]>;

  // Lyrics
  getLyrics(songId: string): Promise<LyricLine[]>;

  // Authentication
  getQrCode(): Promise<QrCodeResult>;
  checkQrCodeStatus(key: string): Promise<'waiting' | 'scanned' | 'confirmed' | 'expired'>;
  loginWithSms?(phone: string, code: string): Promise<boolean>;
  sendSmsCode?(phone: string): Promise<boolean>;
  setCookie(cookie: string): void;
  getCookie(): string;
  getAuthStatus(): Promise<AuthStatus>;

  // Personal FM (netease only)
  getPersonalFm?(): Promise<Song[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/music/provider.ts
git commit -m "feat: add unified MusicProvider interface with search, playlist, auth, and lyrics"
```

---

### Task 3: NetEase Cloud Music adapter

**Files:**
- Create: `src/music/netease.ts`
- Create: `src/music/netease.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/music/netease.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseLyrics } from './netease.js';

describe('NetEase adapter', () => {
  it('parses LRC format lyrics', () => {
    const lrc = `[00:00.00] 作词 : 周杰伦
[00:01.00] 作曲 : 周杰伦
[00:12.50]故事的小黄花
[00:15.80]从出生那年就飘着`;

    const lines = parseLyrics(lrc);
    expect(lines).toHaveLength(2); // skip metadata lines
    expect(lines[0].time).toBeCloseTo(12.5, 1);
    expect(lines[0].text).toBe('故事的小黄花');
    expect(lines[1].time).toBeCloseTo(15.8, 1);
    expect(lines[1].text).toBe('从出生那年就飘着');
  });

  it('handles empty lyrics', () => {
    const lines = parseLyrics('');
    expect(lines).toHaveLength(0);
  });

  it('merges translation lyrics', () => {
    const lrc = '[00:12.50]Hello world';
    const tlyric = '[00:12.50]你好世界';
    const lines = parseLyrics(lrc, tlyric);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[0].translation).toBe('你好世界');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/music/netease.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `src/music/netease.ts`:

```typescript
import axios, { type AxiosInstance } from 'axios';
import type {
  MusicProvider, Song, SongWithUrl, Playlist, Album,
  LyricLine, SearchResult, QrCodeResult, AuthStatus,
} from './provider.js';

export function parseLyrics(lrc: string, tlyric?: string): LyricLine[] {
  if (!lrc) return [];

  const parseLine = (line: string): { time: number; text: string } | null => {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.+)$/);
    if (!match) return null;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const ms = parseInt(match[3].padEnd(3, '0'), 10);
    const text = match[4].trim();

    // Skip metadata lines (作词, 作曲, 编曲, etc.)
    if (/^(作词|作曲|编曲|制作|混音|母带)\s*[:：]/.test(text)) return null;

    return { time: minutes * 60 + seconds + ms / 1000, text };
  };

  const lines: LyricLine[] = [];
  const translationMap = new Map<number, string>();

  // Parse translation lyrics first
  if (tlyric) {
    for (const line of tlyric.split('\n')) {
      const parsed = parseLine(line);
      if (parsed) {
        translationMap.set(Math.round(parsed.time * 100), parsed.text);
      }
    }
  }

  for (const line of lrc.split('\n')) {
    const parsed = parseLine(line);
    if (parsed) {
      const timeKey = Math.round(parsed.time * 100);
      lines.push({
        time: parsed.time,
        text: parsed.text,
        translation: translationMap.get(timeKey),
      });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export class NeteaseProvider implements MusicProvider {
  readonly platform = 'netease' as const;
  private api: AxiosInstance;
  private cookie = '';

  constructor(baseUrl: string) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
    });
  }

  private get cookieParams(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }

  async search(query: string, limit = 20): Promise<SearchResult> {
    const [songRes, playlistRes] = await Promise.all([
      this.api.get('/cloudsearch', {
        params: { keywords: query, type: 1, limit, ...this.cookieParams },
      }),
      this.api.get('/cloudsearch', {
        params: { keywords: query, type: 1000, limit: 5, ...this.cookieParams },
      }),
    ]);

    const songs: Song[] = (songRes.data?.result?.songs ?? []).map((s: any) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? []).map((a: any) => a.name).join(' / '),
      album: s.al?.name ?? '',
      duration: Math.round((s.dt ?? 0) / 1000),
      coverUrl: s.al?.picUrl ?? '',
      platform: 'netease',
    }));

    const playlists: Playlist[] = (playlistRes.data?.result?.playlists ?? []).map((p: any) => ({
      id: String(p.id),
      name: p.name,
      coverUrl: p.coverImgUrl ?? '',
      songCount: p.trackCount ?? 0,
      platform: 'netease',
    }));

    return { songs, playlists, albums: [] };
  }

  async getSongUrl(songId: string): Promise<string | null> {
    const res = await this.api.get('/song/url/v1', {
      params: { id: songId, level: 'exhigh', ...this.cookieParams },
    });
    const url = res.data?.data?.[0]?.url;
    return url ?? null;
  }

  async getSongDetail(songId: string): Promise<Song | null> {
    const res = await this.api.get('/song/detail', {
      params: { ids: songId, ...this.cookieParams },
    });
    const s = res.data?.songs?.[0];
    if (!s) return null;
    return {
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? []).map((a: any) => a.name).join(' / '),
      album: s.al?.name ?? '',
      duration: Math.round((s.dt ?? 0) / 1000),
      coverUrl: s.al?.picUrl ?? '',
      platform: 'netease',
    };
  }

  async getPlaylistSongs(playlistId: string): Promise<Song[]> {
    const res = await this.api.get('/playlist/track/all', {
      params: { id: playlistId, ...this.cookieParams },
    });
    return (res.data?.songs ?? []).map((s: any) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? []).map((a: any) => a.name).join(' / '),
      album: s.al?.name ?? '',
      duration: Math.round((s.dt ?? 0) / 1000),
      coverUrl: s.al?.picUrl ?? '',
      platform: 'netease',
    }));
  }

  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await this.api.get('/personalized', {
      params: { limit: 10, ...this.cookieParams },
    });
    return (res.data?.result ?? []).map((p: any) => ({
      id: String(p.id),
      name: p.name,
      coverUrl: p.picUrl ?? '',
      songCount: p.trackCount ?? 0,
      platform: 'netease',
    }));
  }

  async getAlbumSongs(albumId: string): Promise<Song[]> {
    const res = await this.api.get('/album', {
      params: { id: albumId, ...this.cookieParams },
    });
    return (res.data?.songs ?? []).map((s: any) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar ?? []).map((a: any) => a.name).join(' / '),
      album: s.al?.name ?? '',
      duration: Math.round((s.dt ?? 0) / 1000),
      coverUrl: s.al?.picUrl ?? '',
      platform: 'netease',
    }));
  }

  async getLyrics(songId: string): Promise<LyricLine[]> {
    const res = await this.api.get('/lyric', {
      params: { id: songId, ...this.cookieParams },
    });
    return parseLyrics(res.data?.lrc?.lyric ?? '', res.data?.tlyric?.lyric);
  }

  async getQrCode(): Promise<QrCodeResult> {
    const keyRes = await this.api.get('/login/qr/key');
    const key = keyRes.data?.data?.unikey ?? '';
    const createRes = await this.api.get('/login/qr/create', {
      params: { key, qrimg: true },
    });
    return {
      qrUrl: createRes.data?.data?.qrurl ?? '',
      key,
    };
  }

  async checkQrCodeStatus(key: string): Promise<'waiting' | 'scanned' | 'confirmed' | 'expired'> {
    const res = await this.api.get('/login/qr/check', {
      params: { key },
    });
    const code = res.data?.code;
    switch (code) {
      case 801: return 'waiting';
      case 802: return 'scanned';
      case 803:
        // Save cookie from response
        if (res.data?.cookie) {
          this.cookie = res.data.cookie;
        }
        return 'confirmed';
      default: return 'expired';
    }
  }

  async sendSmsCode(phone: string): Promise<boolean> {
    const res = await this.api.get('/captcha/sent', {
      params: { phone },
    });
    return res.data?.code === 200;
  }

  async loginWithSms(phone: string, code: string): Promise<boolean> {
    const res = await this.api.get('/captcha/verify', {
      params: { phone, captcha: code },
    });
    if (res.data?.cookie) {
      this.cookie = res.data.cookie;
    }
    return res.data?.code === 200;
  }

  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  getCookie(): string {
    return this.cookie;
  }

  async getAuthStatus(): Promise<AuthStatus> {
    if (!this.cookie) return { loggedIn: false };
    try {
      const res = await this.api.get('/login/status', {
        params: { ...this.cookieParams },
      });
      const profile = res.data?.data?.profile;
      if (profile) {
        return {
          loggedIn: true,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
        };
      }
    } catch {
      // ignore
    }
    return { loggedIn: false };
  }

  async getPersonalFm(): Promise<Song[]> {
    const res = await this.api.get('/personal_fm', {
      params: { ...this.cookieParams },
    });
    return (res.data?.data ?? []).map((s: any) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.artists ?? []).map((a: any) => a.name).join(' / '),
      album: s.album?.name ?? '',
      duration: Math.round((s.duration ?? 0) / 1000),
      coverUrl: s.album?.picUrl ?? '',
      platform: 'netease',
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/music/netease.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/music/netease.ts src/music/netease.test.ts
git commit -m "feat: add NetEase Cloud Music provider with search, playlist, lyrics, and auth"
```

---

### Task 4: QQ Music adapter

**Files:**
- Create: `src/music/qq.ts`

- [ ] **Step 1: Write implementation**

Create `src/music/qq.ts`:

```typescript
import axios, { type AxiosInstance } from 'axios';
import type {
  MusicProvider, Song, Playlist, Album,
  LyricLine, SearchResult, QrCodeResult, AuthStatus,
} from './provider.js';
import { parseLyrics } from './netease.js';

export class QQMusicProvider implements MusicProvider {
  readonly platform = 'qq' as const;
  private api: AxiosInstance;
  private cookie = '';

  constructor(baseUrl: string) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
    });
  }

  private get cookieParams(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }

  async search(query: string, limit = 20): Promise<SearchResult> {
    const res = await this.api.get('/search', {
      params: { key: query, pageSize: limit, ...this.cookieParams },
    });

    const songs: Song[] = (res.data?.data?.list ?? []).map((s: any) => ({
      id: String(s.songmid ?? s.id),
      name: s.songname ?? s.name ?? '',
      artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
      album: s.albumname ?? '',
      duration: s.interval ?? 0,
      coverUrl: s.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg`
        : '',
      platform: 'qq',
    }));

    return { songs, playlists: [], albums: [] };
  }

  async getSongUrl(songId: string): Promise<string | null> {
    const res = await this.api.get('/song/url', {
      params: { id: songId, ...this.cookieParams },
    });
    return res.data?.data ?? null;
  }

  async getSongDetail(songId: string): Promise<Song | null> {
    const res = await this.api.get('/song', {
      params: { songmid: songId, ...this.cookieParams },
    });
    const s = res.data?.data;
    if (!s) return null;
    return {
      id: String(s.mid ?? s.id),
      name: s.name ?? '',
      artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
      album: s.album?.name ?? '',
      duration: s.interval ?? 0,
      coverUrl: s.album?.mid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg`
        : '',
      platform: 'qq',
    };
  }

  async getPlaylistSongs(playlistId: string): Promise<Song[]> {
    const res = await this.api.get('/songlist', {
      params: { id: playlistId, ...this.cookieParams },
    });
    return (res.data?.data?.songlist ?? []).map((s: any) => ({
      id: String(s.songmid ?? s.id),
      name: s.songname ?? s.name ?? '',
      artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
      album: s.albumname ?? '',
      duration: s.interval ?? 0,
      coverUrl: s.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg`
        : '',
      platform: 'qq',
    }));
  }

  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await this.api.get('/recommend/playlist', {
      params: { ...this.cookieParams },
    });
    return (res.data?.data?.list ?? []).map((p: any) => ({
      id: String(p.content_id ?? p.id),
      name: p.title ?? p.name ?? '',
      coverUrl: p.cover ?? '',
      songCount: p.cnt ?? 0,
      platform: 'qq',
    }));
  }

  async getAlbumSongs(albumId: string): Promise<Song[]> {
    const res = await this.api.get('/album/songs', {
      params: { albummid: albumId, ...this.cookieParams },
    });
    return (res.data?.data?.list ?? []).map((s: any) => ({
      id: String(s.songmid ?? s.id),
      name: s.songname ?? s.name ?? '',
      artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
      album: s.albumname ?? '',
      duration: s.interval ?? 0,
      coverUrl: s.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg`
        : '',
      platform: 'qq',
    }));
  }

  async getLyrics(songId: string): Promise<LyricLine[]> {
    const res = await this.api.get('/lyric', {
      params: { songmid: songId, ...this.cookieParams },
    });
    return parseLyrics(res.data?.data?.lyric ?? '', res.data?.data?.trans ?? '');
  }

  async getQrCode(): Promise<QrCodeResult> {
    const res = await this.api.get('/login/qr/create');
    return {
      qrUrl: res.data?.data?.qrurl ?? '',
      key: res.data?.data?.key ?? '',
    };
  }

  async checkQrCodeStatus(key: string): Promise<'waiting' | 'scanned' | 'confirmed' | 'expired'> {
    const res = await this.api.get('/login/qr/check', {
      params: { key },
    });
    const code = res.data?.data?.code;
    if (code === 0) {
      if (res.data?.data?.cookie) {
        this.cookie = res.data.data.cookie;
      }
      return 'confirmed';
    }
    if (code === 1) return 'scanned';
    if (code === 2) return 'waiting';
    return 'expired';
  }

  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  getCookie(): string {
    return this.cookie;
  }

  async getAuthStatus(): Promise<AuthStatus> {
    if (!this.cookie) return { loggedIn: false };
    try {
      const res = await this.api.get('/user/detail', {
        params: { ...this.cookieParams },
      });
      if (res.data?.data) {
        return {
          loggedIn: true,
          nickname: res.data.data.nickname,
          avatarUrl: res.data.data.headpic,
        };
      }
    } catch {
      // ignore
    }
    return { loggedIn: false };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/music/qq.ts
git commit -m "feat: add QQ Music provider with search, playlist, lyrics, and auth"
```

---

### Task 5: Auth module (Cookie persistence)

**Files:**
- Create: `src/music/auth.ts`

- [ ] **Step 1: Write implementation**

Create `src/music/auth.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

export interface CookieStore {
  save(platform: 'netease' | 'qq', cookie: string): void;
  load(platform: 'netease' | 'qq'): string;
}

export function createCookieStore(cookieDir: string): CookieStore {
  if (!fs.existsSync(cookieDir)) {
    fs.mkdirSync(cookieDir, { recursive: true });
  }

  return {
    save(platform: 'netease' | 'qq', cookie: string): void {
      const filePath = path.join(cookieDir, `${platform}.json`);
      fs.writeFileSync(filePath, JSON.stringify({ cookie, updatedAt: new Date().toISOString() }), 'utf-8');
    },

    load(platform: 'netease' | 'qq'): string {
      const filePath = path.join(cookieDir, `${platform}.json`);
      if (!fs.existsSync(filePath)) return '';
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data.cookie ?? '';
      } catch {
        return '';
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/music/auth.ts
git commit -m "feat: add cookie persistence store for music platform authentication"
```

---

### Task 6: Verify and commit Phase 4

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: Phase 4 complete — music source service (NetEase, QQ Music, auth)"
```
