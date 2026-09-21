import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// 审计 A1/B1 回归：playSong 必须按身份分流 play-now-song / play-song，
// 且 200 + {ok:false,message} 是业务失败——要提示真实原因并跳过乐观更新。
const hoisted = vi.hoisted(() => ({
  isGuest: false,
  postMock: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('../utils/http', () => ({
  http: {
    post: hoisted.postMock,
    get: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn(),
  },
}));

vi.mock('../composables/useToast', () => ({
  useToast: () => hoisted.toast,
}));

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({ isGuest: hoisted.isGuest }),
}));

import { usePlayerStore } from './player';

const song = {
  id: 's1',
  name: '测试歌',
  artist: '歌手',
  album: '',
  duration: 240,
  coverUrl: '',
  platform: 'netease' as const,
};

describe('player store playSong 身份分流（审计 A1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    hoisted.postMock.mockReset();
    hoisted.isGuest = false;
    vi.clearAllMocks();
  });

  it('成员走 /play-song', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playSong(song);
    expect(hoisted.postMock).toHaveBeenCalledWith('/api/player/bot1/play-song', { song });
  });

  it('游客走 /play-now-song（非破坏性播放）', async () => {
    hoisted.isGuest = true;
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playSong(song);
    expect(hoisted.postMock).toHaveBeenCalledWith('/api/player/bot1/play-now-song', { song });
  });
});

describe('player store playSong 业务失败分支（审计 B1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    hoisted.postMock.mockReset();
    vi.clearAllMocks();
  });

  it('200 + ok:false 时提示 message 且不做乐观更新', async () => {
    hoisted.postMock.mockResolvedValue({
      data: { ok: false, message: '无法播放「测试歌」（区域/版权限制）' },
    });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    const optimistic = vi.spyOn(store, '_optimisticPlay').mockImplementation(() => {});
    await store.playSong(song);
    expect(hoisted.toast.error).toHaveBeenCalledWith('无法播放「测试歌」（区域/版权限制）');
    expect(hoisted.toast.success).not.toHaveBeenCalled();
    expect(optimistic).not.toHaveBeenCalled();
  });

  it('成功路径照常乐观更新', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    const optimistic = vi.spyOn(store, '_optimisticPlay').mockImplementation(() => {});
        await store.playSong(song);
    expect(hoisted.toast.success).toHaveBeenCalled();
    expect(optimistic).toHaveBeenCalled();
  });
});

// 多机器人：Navbar 下拉栏的播放控制必须作用于按钮所在行的 bot，
// 而不是当前选中的 bot（无参调用保持原语义——作用于 activeBotId）。
describe('player store 跨 bot 播放控制（多机器人下拉栏）', () => {
  const twoBots = [
    { id: 'bot1', name: '一号', playing: true, paused: false, connected: true },
    { id: 'bot2', name: '二号', playing: true, paused: false, connected: true },
  ] as any;

  function makeStore() {
    setActivePinia(createPinia());
    hoisted.postMock.mockReset();
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.bots = twoBots.map((b: any) => ({ ...b })) as any;
    store.activeBotId = 'bot1';
    return store;
  }

  const botById = (store: ReturnType<typeof usePlayerStore>, id: string) =>
    store.bots.find((b: any) => b.id === id)!;

  it("pause('bot2') 请求打到 bot2 且乐观更新只改 bot2（bot1 不受影响）", async () => {
    const store = makeStore();
    await store.pause('bot2');
    expect(hoisted.postMock).toHaveBeenCalledWith('/api/player/bot2/pause');
    expect(botById(store, 'bot1').paused).toBe(false);
    expect(botById(store, 'bot2').paused).toBe(true);
  });

  it("resume('bot2') 同理作用于 bot2", async () => {
    const store = makeStore();
    botById(store, 'bot2').paused = true;
    await store.resume('bot2');
    expect(hoisted.postMock).toHaveBeenCalledWith('/api/player/bot2/resume');
    expect(botById(store, 'bot2').paused).toBe(false);
  });

  it("next('bot2') 打到 bot2 且不为非当前 bot 触发 active 轮询同步", async () => {
    const store = makeStore();
    const sync = vi.spyOn(store, '_syncAfterAction');
    await store.next('bot2');
    expect(hoisted.postMock).toHaveBeenCalledWith('/api/player/bot2/next');
    expect(sync).not.toHaveBeenCalled();
  });

  it('无参调用保持原语义：作用于当前选中 bot', async () => {
    const store = makeStore();
    await store.next();
    expect(hoisted.postMock).toHaveBeenCalledWith('/api/player/bot1/next');
  });
});
