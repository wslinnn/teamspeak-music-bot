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
