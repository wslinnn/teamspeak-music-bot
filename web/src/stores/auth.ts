import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { http } from '../utils/http';

export interface SessionUser {
  id: string;
  username: string;
  role: 'admin' | 'member' | 'guest';
  /** 细粒度能力（/api/session/me 返回；admin 恒全量） */
  capabilities?: string[];
  /** 可控 bot 白名单："all" 或 id 列表 */
  bots?: 'all' | string[];
  /** 游客模式逐项开关（仅 role=guest 时有值） */
  guest?: Record<string, boolean> | null;
}

const ROLE_LABELS: Record<SessionUser['role'], string> = {
  admin: '管理员',
  member: '成员',
  guest: '游客',
};

export const useAuthStore = defineStore('auth', () => {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const needsSetup = ref<boolean | null>(null);
  const guestAllowed = ref(false);
  const user = ref<SessionUser | null>(null);
  let initPromise: Promise<void> | null = null;

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.role === 'admin');
  const isGuest = computed(() => user.value?.role === 'guest');
  const username = computed(() => user.value?.username ?? '');
  const roleLabel = computed(() => (user.value ? ROLE_LABELS[user.value.role] : ''));

  function clearSession(): void {
    user.value = null;
  }

  /** 拉取权威会话信息（含 capabilities/bots/guest 开关；登录等接口的响应不带这些字段） */
  async function refreshMe(): Promise<void> {
    const me = await http.get('/api/session/me');
    user.value = me.data as SessionUser;
  }

  /** 是否具备某项能力（admin 恒有） */
  function can(cap: string): boolean {
    const u = user.value;
    return !!u && (u.role === 'admin' || (u.capabilities ?? []).includes(cap));
  }

  /** 游客模式逐项开关（transport/skip/playMode/playNow/playNext/addToQueue/removeClear…） */
  function guestCan(flag: string): boolean {
    const u = user.value;
    return !!u && u.role === 'guest' && u.guest?.[flag] === true;
  }

  /** 是否可控制指定 bot（bot 白名单） */
  function canControlBot(botId: string): boolean {
    const u = user.value;
    if (!u) return false;
    if (u.role === 'admin' || u.bots === 'all') return true;
    return Array.isArray(u.bots) && u.bots.includes(botId);
  }

  /** 首次加载：查询初始化状态并尝试从 Cookie 恢复会话 */
  async function init(): Promise<void> {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        const res = await http.get('/api/session/needs-setup');
        needsSetup.value = res.data.needsSetup === true;
        guestAllowed.value = res.data.guestAllowed === true;
      } catch (err) {
        // 后端不可达时不阻塞路由，页面加载后续请求会给出提示
        console.warn('Failed to check session setup state:', err);
        needsSetup.value = false;
        return;
      }

      if (!needsSetup.value) {
        try {
          const me = await http.get('/api/session/me');
          user.value = me.data as SessionUser;
        } catch (meErr: unknown) {
          const meStatus = (meErr as any)?.response?.status;
          if (meStatus && meStatus !== 401) {
            console.warn('Failed to restore session:', meErr);
          }
          user.value = null;
        }
      }
    })().finally(() => {
      initPromise = null;
    });

    return initPromise;
  }

  async function login(name: string, password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/session/login', { username: name, password });
      user.value = { id: res.data.id, username: res.data.username, role: res.data.role };
      await refreshMe().catch(() => {});
      return true;
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : '登录失败');
      error.value = msg === 'invalid credentials' ? '用户名或密码错误' : msg;
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function loginGuest(): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/session/guest');
      user.value = { id: res.data.id, username: res.data.username, role: res.data.role };
      await refreshMe().catch(() => {});
      return true;
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : '游客登录失败');
      error.value = msg === 'guest mode disabled' ? '管理员未开放游客访问' : msg;
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function setup(name: string, password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/session/setup', { username: name, password });
      user.value = { id: res.data.id, username: res.data.username, role: res.data.role };
      needsSetup.value = false;
      await refreshMe().catch(() => {});
      return true;
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : '初始化失败');
      if (msg === 'invalid username or password') {
        error.value = '用户名需 3-32 位字母/数字/_-.，密码至少 8 位';
      } else if (msg === 'already initialized') {
        error.value = '已初始化过，请直接登录';
      } else {
        error.value = msg;
      }
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout(): void {
    clearSession();
    http.post('/api/session/logout').catch(() => {});
  }

  return {
    loading,
    error,
    needsSetup,
    guestAllowed,
    user,
    username,
    roleLabel,
    isAuthenticated,
    isAdmin,
    isGuest,
    init,
    refreshMe,
    login,
    loginGuest,
    setup,
    logout,
    clearSession,
    can,
    guestCan,
    canControlBot,
  };
});
