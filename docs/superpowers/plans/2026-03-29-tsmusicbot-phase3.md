# TSMusicBot Phase 3: Audio Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the audio pipeline: FFmpeg decodes audio from a URL → PCM → Opus encoding → 20ms frames ready to send via TS3 voice. Plus a play queue with 4 modes (sequential, loop, random, random-loop).

**Architecture:** `src/audio/encoder.ts` wraps Opus encoding, `src/audio/player.ts` orchestrates FFmpeg → Opus → timed frame emission, `src/audio/queue.ts` manages the song queue with playback modes.

**Tech Stack:** FFmpeg (child_process), @discordjs/opus, vitest

---

### Task 1: Opus encoder wrapper

**Files:**
- Create: `src/audio/encoder.ts`
- Create: `src/audio/encoder.test.ts`

- [ ] **Step 1: Install opus dependency**

```bash
npm install @discordjs/opus
```

- [ ] **Step 2: Write the failing test**

Create `src/audio/encoder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createOpusEncoder } from './encoder.js';

describe('OpusEncoder', () => {
  it('encodes PCM buffer to Opus frame', () => {
    const encoder = createOpusEncoder();
    // 20ms of silence at 48kHz stereo = 960 frames * 2 channels * 2 bytes = 3840 bytes
    const silence = Buffer.alloc(3840, 0);
    const opus = encoder.encode(silence);
    expect(opus).toBeInstanceOf(Buffer);
    expect(opus.length).toBeGreaterThan(0);
    expect(opus.length).toBeLessThan(3840); // compressed should be smaller
  });

  it('decodes Opus frame back to PCM', () => {
    const encoder = createOpusEncoder();
    const silence = Buffer.alloc(3840, 0);
    const opus = encoder.encode(silence);
    const pcm = encoder.decode(opus);
    expect(pcm).toBeInstanceOf(Buffer);
    expect(pcm.length).toBe(3840);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/audio/encoder.test.ts`
Expected: FAIL

- [ ] **Step 4: Write implementation**

Create `src/audio/encoder.ts`:

```typescript
import { OpusEncoder } from '@discordjs/opus';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_DURATION_MS = 20;
export const FRAME_SIZE = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960 samples
export const PCM_FRAME_BYTES = FRAME_SIZE * CHANNELS * 2; // 3840 bytes (16-bit stereo)

export interface Encoder {
  encode(pcm: Buffer): Buffer;
  decode(opus: Buffer): Buffer;
}

export function createOpusEncoder(): Encoder {
  const opus = new OpusEncoder(SAMPLE_RATE, CHANNELS);

  return {
    encode(pcm: Buffer): Buffer {
      return opus.encode(pcm);
    },
    decode(opusData: Buffer): Buffer {
      return opus.decode(opusData);
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/audio/encoder.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/audio/encoder.ts src/audio/encoder.test.ts package.json package-lock.json
git commit -m "feat: add Opus encoder/decoder wrapper"
```

---

### Task 2: Play queue with modes

**Files:**
- Create: `src/audio/queue.ts`
- Create: `src/audio/queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/audio/queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { PlayQueue, type QueuedSong, PlayMode } from './queue.js';

function makeSong(id: string, name: string = id): QueuedSong {
  return {
    id,
    name,
    artist: 'Artist',
    album: 'Album',
    platform: 'netease',
    url: `https://example.com/${id}.mp3`,
    coverUrl: `https://example.com/${id}.jpg`,
    duration: 240,
  };
}

describe('PlayQueue', () => {
  let queue: PlayQueue;

  beforeEach(() => {
    queue = new PlayQueue();
  });

  it('starts empty', () => {
    expect(queue.isEmpty()).toBe(true);
    expect(queue.current()).toBeNull();
    expect(queue.size()).toBe(0);
  });

  it('adds and retrieves songs', () => {
    queue.add(makeSong('1', 'Song A'));
    queue.add(makeSong('2', 'Song B'));
    expect(queue.size()).toBe(2);
    expect(queue.list()[0].name).toBe('Song A');
    expect(queue.list()[1].name).toBe('Song B');
  });

  it('plays first song when starting', () => {
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.play();
    expect(queue.current()?.id).toBe('1');
  });

  it('advances to next song in sequential mode', () => {
    queue.setMode(PlayMode.Sequential);
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.add(makeSong('3'));
    queue.play();
    expect(queue.current()?.id).toBe('1');
    const next = queue.next();
    expect(next?.id).toBe('2');
    expect(queue.current()?.id).toBe('2');
  });

  it('returns null at end in sequential mode', () => {
    queue.setMode(PlayMode.Sequential);
    queue.add(makeSong('1'));
    queue.play();
    const next = queue.next();
    expect(next).toBeNull();
  });

  it('loops in loop mode', () => {
    queue.setMode(PlayMode.Loop);
    queue.add(makeSong('1'));
    queue.play();
    const next = queue.next();
    expect(next?.id).toBe('1'); // loops back
  });

  it('goes to previous song', () => {
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.play();
    queue.next();
    expect(queue.current()?.id).toBe('2');
    queue.prev();
    expect(queue.current()?.id).toBe('1');
  });

  it('removes song by index', () => {
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.add(makeSong('3'));
    queue.remove(1); // remove index 1 ("2")
    expect(queue.size()).toBe(2);
    expect(queue.list()[1].id).toBe('3');
  });

  it('clears all songs', () => {
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.clear();
    expect(queue.isEmpty()).toBe(true);
    expect(queue.current()).toBeNull();
  });

  it('random mode returns a song', () => {
    queue.setMode(PlayMode.Random);
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.add(makeSong('3'));
    queue.play();
    const next = queue.next();
    expect(next).not.toBeNull();
  });

  it('random-loop mode never returns null', () => {
    queue.setMode(PlayMode.RandomLoop);
    queue.add(makeSong('1'));
    queue.play();
    // Should always return a song
    for (let i = 0; i < 10; i++) {
      expect(queue.next()).not.toBeNull();
    }
  });

  it('playAt jumps to specific index', () => {
    queue.add(makeSong('1'));
    queue.add(makeSong('2'));
    queue.add(makeSong('3'));
    queue.playAt(2);
    expect(queue.current()?.id).toBe('3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/queue.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `src/audio/queue.ts`:

```typescript
export enum PlayMode {
  Sequential = 'seq',
  Loop = 'loop',
  Random = 'random',
  RandomLoop = 'rloop',
}

export interface QueuedSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  platform: 'netease' | 'qq';
  url: string;
  coverUrl: string;
  duration: number; // seconds
}

export class PlayQueue {
  private songs: QueuedSong[] = [];
  private currentIndex = -1;
  private mode: PlayMode = PlayMode.Sequential;

  add(song: QueuedSong): void {
    this.songs.push(song);
  }

  addMany(songs: QueuedSong[]): void {
    this.songs.push(...songs);
  }

  remove(index: number): QueuedSong | null {
    if (index < 0 || index >= this.songs.length) return null;
    const [removed] = this.songs.splice(index, 1);

    // Adjust current index if needed
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex) {
      // Current song was removed, keep index but it now points to next song
      if (this.currentIndex >= this.songs.length) {
        this.currentIndex = this.songs.length - 1;
      }
    }

    return removed;
  }

  clear(): void {
    this.songs = [];
    this.currentIndex = -1;
  }

  play(): QueuedSong | null {
    if (this.songs.length === 0) return null;
    this.currentIndex = 0;
    return this.songs[0];
  }

  playAt(index: number): QueuedSong | null {
    if (index < 0 || index >= this.songs.length) return null;
    this.currentIndex = index;
    return this.songs[index];
  }

  next(): QueuedSong | null {
    if (this.songs.length === 0) return null;

    switch (this.mode) {
      case PlayMode.Sequential: {
        const nextIndex = this.currentIndex + 1;
        if (nextIndex >= this.songs.length) return null;
        this.currentIndex = nextIndex;
        return this.songs[nextIndex];
      }
      case PlayMode.Loop: {
        this.currentIndex = (this.currentIndex + 1) % this.songs.length;
        return this.songs[this.currentIndex];
      }
      case PlayMode.Random: {
        if (this.songs.length === 1) return this.songs[0];
        let nextIndex: number;
        do {
          nextIndex = Math.floor(Math.random() * this.songs.length);
        } while (nextIndex === this.currentIndex && this.songs.length > 1);
        this.currentIndex = nextIndex;
        return this.songs[nextIndex];
      }
      case PlayMode.RandomLoop: {
        // Same as Random but never returns null
        if (this.songs.length === 1) {
          this.currentIndex = 0;
          return this.songs[0];
        }
        let idx: number;
        do {
          idx = Math.floor(Math.random() * this.songs.length);
        } while (idx === this.currentIndex);
        this.currentIndex = idx;
        return this.songs[idx];
      }
    }
  }

  prev(): QueuedSong | null {
    if (this.songs.length === 0) return null;
    const prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      this.currentIndex = this.songs.length - 1; // wrap to end
    } else {
      this.currentIndex = prevIndex;
    }
    return this.songs[this.currentIndex];
  }

  current(): QueuedSong | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.songs.length) return null;
    return this.songs[this.currentIndex];
  }

  list(): QueuedSong[] {
    return [...this.songs];
  }

  size(): number {
    return this.songs.length;
  }

  isEmpty(): boolean {
    return this.songs.length === 0;
  }

  getMode(): PlayMode {
    return this.mode;
  }

  setMode(mode: PlayMode): void {
    this.mode = mode;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/audio/queue.test.ts`
Expected: 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio/queue.ts src/audio/queue.test.ts
git commit -m "feat: add play queue with sequential, loop, random, and random-loop modes"
```

---

### Task 3: Audio player (FFmpeg → Opus → timed frames)

**Files:**
- Create: `src/audio/player.ts`

- [ ] **Step 1: Write implementation**

Create `src/audio/player.ts`:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createOpusEncoder, PCM_FRAME_BYTES, type Encoder } from './encoder.js';
import type { Logger } from '../logger.js';

export interface PlayerEvents {
  frame: (opusFrame: Buffer) => void;
  trackEnd: () => void;
  error: (err: Error) => void;
}

export type PlayerState = 'idle' | 'playing' | 'paused';

export class AudioPlayer extends EventEmitter {
  private ffmpeg: ChildProcess | null = null;
  private encoder: Encoder;
  private state: PlayerState = 'idle';
  private volume = 75; // 0-100
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private pcmBuffer: Buffer = Buffer.alloc(0);
  private logger: Logger;

  constructor(logger: Logger) {
    super();
    this.encoder = createOpusEncoder();
    this.logger = logger;
  }

  /**
   * Start playing audio from a URL or file path.
   * FFmpeg decodes to raw PCM (48kHz, stereo, s16le).
   */
  play(url: string): void {
    this.stop();

    this.logger.info({ url }, 'Starting playback');

    this.ffmpeg = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', url,
      '-f', 's16le',        // raw PCM output
      '-ar', '48000',        // 48kHz sample rate
      '-ac', '2',            // stereo
      '-af', `volume=${this.volume / 100}`,
      '-',                   // output to stdout
    ], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
      this.pcmBuffer = Buffer.concat([this.pcmBuffer, chunk]);
    });

    this.ffmpeg.on('close', (code) => {
      this.logger.debug({ code }, 'FFmpeg process closed');
      if (this.state === 'playing') {
        // Flush remaining frames
        this.flushRemainingFrames();
        this.state = 'idle';
        this.emit('trackEnd');
      }
    });

    this.ffmpeg.on('error', (err) => {
      this.logger.error({ err }, 'FFmpeg error');
      this.emit('error', err);
    });

    this.state = 'playing';

    // Send frames every 20ms
    this.frameTimer = setInterval(() => {
      if (this.state !== 'playing') return;
      this.sendNextFrame();
    }, 20);
  }

  private sendNextFrame(): void {
    if (this.pcmBuffer.length < PCM_FRAME_BYTES) return;

    const pcmFrame = this.pcmBuffer.subarray(0, PCM_FRAME_BYTES);
    this.pcmBuffer = this.pcmBuffer.subarray(PCM_FRAME_BYTES);

    const opusFrame = this.encoder.encode(Buffer.from(pcmFrame));
    this.emit('frame', opusFrame);
  }

  private flushRemainingFrames(): void {
    while (this.pcmBuffer.length >= PCM_FRAME_BYTES) {
      this.sendNextFrame();
    }
  }

  pause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.logger.debug('Playback paused');
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.logger.debug('Playback resumed');
    }
  }

  stop(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = null;
    }
    this.pcmBuffer = Buffer.alloc(0);
    this.state = 'idle';
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(100, vol));
    // Volume change takes effect on next track.
    // For live volume change, we'd need to restart FFmpeg or use a PCM gain stage.
    // TODO: implement PCM-level volume adjustment for live changes
  }

  getVolume(): number {
    return this.volume;
  }

  getState(): PlayerState {
    return this.state;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/player.ts
git commit -m "feat: add audio player with FFmpeg decode, Opus encode, and 20ms frame timing"
```

---

### Task 4: Verify compilation and all tests

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (encoder: 2, queue: 12, identity: 3, commands: 6, config: 3, database: 4 = 30 tests)

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: Phase 3 complete — audio engine (Opus encoder, play queue, FFmpeg player)"
```
