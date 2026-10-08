import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// 审计 A1/B1 回归：playSong 必须按身份分流 play-now-song / play-song，
// 且 200 + {ok:false,message} 是业务失败——要提示真实原因并跳过乐观更新。
const hoisted = vi.hoisted(() => ({
  isGuest: false,
  postMock: vi.fn(),
  getMock: vi.fn().mockResolvedValue({ data: {} }),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('../utils/http', () => ({
  http: {
    post: hoisted.postMock,
    get: hoisted.getMock,
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

// 整歌手入队（T2 艺人页）：请求带 skipErrorToast 自管文案（拦截器会直出
// 后端 501 英文裸文案）；目标 bot 走 _targetBotId 模式；200+ok:false 是
// 业务失败——提示真实原因且不做乐观更新。
describe('player store playArtist（T2 艺人页）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    hoisted.postMock.mockReset();
    vi.clearAllMocks();
  });

  it('缺省作用于当前选中 bot，先发载入提示，成功后乐观更新', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    const optimistic = vi.spyOn(store, '_optimisticPlay').mockImplementation(() => {});
    await store.playArtist('ar1', 'netease');
    expect(hoisted.postMock).toHaveBeenCalledWith(
      '/api/player/bot1/play-artist',
      { artistId: 'ar1', platform: 'netease' },
      { skipErrorToast: true },
    );
    expect(hoisted.toast.info).toHaveBeenCalledWith('正在载入该歌手的全部歌曲…');
    expect(optimistic).toHaveBeenCalled();
  });

  it('传 botId 时请求打到目标 bot（跨 bot 下拉栏）', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playArtist('ar1', 'qq', 'bot2');
    expect(hoisted.postMock).toHaveBeenCalledWith(
      '/api/player/bot2/play-artist',
      { artistId: 'ar1', platform: 'qq' },
      { skipErrorToast: true },
    );
  });

  it('200 + ok:false 提示 message 且不做乐观更新', async () => {
    hoisted.postMock.mockResolvedValue({
      data: { ok: false, message: '歌手 100 首歌曲均无版权可播放（区域/版权限制）' },
    });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    const optimistic = vi.spyOn(store, '_optimisticPlay').mockImplementation(() => {});
    await store.playArtist('ar1');
    expect(hoisted.toast.error).toHaveBeenCalledWith('歌手 100 首歌曲均无版权可播放（区域/版权限制）');
    expect(optimistic).not.toHaveBeenCalled();
  });

  it('403/501 按状态码提示中文文案', async () => {
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    hoisted.postMock.mockRejectedValueOnce({ response: { status: 403 } });
    await store.playArtist('ar1');
    expect(hoisted.toast.error).toHaveBeenCalledWith('没有权限播放该歌手的全部歌曲');
    hoisted.postMock.mockRejectedValueOnce({ response: { status: 501 } });
    await store.playArtist('ar1');
    expect(hoisted.toast.error).toHaveBeenCalledWith('该音源不支持播放歌手歌曲');
  });
});

// B 站多 P 拦截（T3）：多 P 弹窗接管（handled=true 短路，不发播放请求——
// 弹窗组件必须同批上线，缺一则多 P 视频静默不播）；skipPartCheck 供弹窗
// 选定后重入；单 P 顺手修正时长；查询失败降级正常播放。
describe('player store B 站多 P 拦截（T3）', () => {
  const multiP = {
    id: 'BV1multi', name: '多P视频', artist: 'UP主', album: '',
    coverUrl: '', duration: 100, platform: 'bilibili' as const,
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    hoisted.postMock.mockReset();
    hoisted.getMock.mockReset().mockResolvedValue({ data: {} });
    hoisted.isGuest = false;
    vi.clearAllMocks();
  });

  it('多 P 视频弹窗接管：置位 biliPartModal 且不发播放请求', async () => {
    hoisted.getMock.mockResolvedValueOnce({
      data: { bvid: 'BV1multi', title: '多P视频', coverUrl: '', artist: 'UP主', parts: [
        { part: 1, cid: 11, title: '上半', duration: 60 },
        { part: 2, cid: 22, title: '下半', duration: 40 },
      ] },
    });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playSong(multiP);
    expect(hoisted.getMock).toHaveBeenCalledWith('/api/music/bilibili/parts', { params: { bvid: 'BV1multi' } });
    expect(store.biliPartModal.open).toBe(true);
    expect(store.biliPartModal.action).toBe('play');
    expect(store.biliPartModal.parts).toHaveLength(2);
    expect(hoisted.postMock).not.toHaveBeenCalled();
  });

  it('skipPartCheck=true 跳过拦截直接播放（弹窗选定后的重入路径）', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playSong(multiP, true);
    expect(hoisted.getMock).not.toHaveBeenCalled();
    expect(hoisted.postMock).toHaveBeenCalled();
    expect(store.biliPartModal.open).toBe(false);
  });

  it('单 P 视频不拦截，顺手把时长修正为分 P 实际时长', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    hoisted.getMock.mockResolvedValueOnce({
      data: { parts: [{ part: 1, cid: 11, title: '正片', duration: 321 }] },
    });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    const song = { ...multiP, id: 'BV1single', duration: 100 };
    await store.playSong(song);
    expect(store.biliPartModal.open).toBe(false);
    expect(hoisted.postMock).toHaveBeenCalled();
    expect(song.duration).toBe(321);
  });

  it('分 P 查询失败降级为正常播放', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    hoisted.getMock.mockRejectedValueOnce(new Error('network'));
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playSong(multiP);
    expect(store.biliPartModal.open).toBe(false);
    expect(hoisted.postMock).toHaveBeenCalled();
  });

  it('selectBilibiliPart 以 bvid?p=N 重组歌曲按原动作重入播放', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    store.biliPartModal = {
      open: true, song: multiP, action: 'play', bvid: 'BV1multi',
      title: '多P视频', coverUrl: 'c.jpg', artist: 'UP主',
      parts: [
        { part: 1, cid: 11, title: '上半', duration: 60 },
        { part: 2, cid: 22, title: '下半', duration: 40 },
      ],
    };
    store.selectBilibiliPart({ part: 2, cid: 22, title: '下半', duration: 40 });
    await Promise.resolve();
    expect(store.biliPartModal.open).toBe(false);
    expect(hoisted.postMock).toHaveBeenCalledWith(
      '/api/player/bot1/play-song',
      expect.objectContaining({
        song: expect.objectContaining({ id: 'BV1multi?p=2', name: '多P视频 - P2 下半', duration: 40 }),
      }),
    );
  });

  it('非 bilibili 平台不触发分 P 查询', async () => {
    hoisted.postMock.mockResolvedValue({ data: {} });
    const store = usePlayerStore();
    store.activeBotId = 'bot1';
    await store.playSong({ ...multiP, platform: 'netease' });
    expect(hoisted.getMock).not.toHaveBeenCalled();
    expect(hoisted.postMock).toHaveBeenCalled();
  });
});
