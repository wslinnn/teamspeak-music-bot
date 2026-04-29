import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { http } from '../utils/http';

function parseJwt(token: string): { role?: string; sub?: string; exp?: number } | null {
  try {
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;
  return Date.now() >= payload.exp * 1000;
}

export const useAuthStore = defineStore('auth', () => {
  const rawToken = localStorage.getItem('jwt_token');
  const token = ref<string | null>(rawToken && !isTokenExpired(rawToken) ? rawToken : null);
  if (rawToken && !token.value) {
    localStorage.removeItem('jwt_token');
  }
  const loading = ref(false);
  const error = ref<string | null>(null);
  const authEnabled = ref<boolean | null>(null);
  const needsSetup = ref<boolean | null>(null);

  const isAuthenticated = computed(() => {
    if (!token.value) return false;
    return !isTokenExpired(token.value);
  });

  const role = computed(() => {
    if (!token.value) return null;
    return parseJwt(token.value)?.role ?? null;
  });

  const isAdmin = computed(() => role.value === 'admin');

  async function checkAuthEnabled(): Promise<boolean> {
    try {
      const res = await http.get('/api/health');
      authEnabled.value = res.data.authEnabled === true;
      needsSetup.value = res.data.needsSetup === true;
      return authEnabled.value;
    } catch (err: unknown) {
      const status = (err as any)?.response?.status;
      if (!status) throw err;
      authEnabled.value = false;
      needsSetup.value = false;
      return false;
    }
  }

  async function login(password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/auth/login', { password });
      if (res.data.success) {
        token.value = res.data.token;
        localStorage.setItem('jwt_token', res.data.token);
        return true;
      }
      error.value = res.data.error ?? 'Login failed';
      return false;
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Login failed');
      error.value = msg;
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function setup(password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/setup', { password });
      if (res.data.success) {
        needsSetup.value = false;
        return true;
      }
      error.value = res.data.error ?? 'Setup failed';
      return false;
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Setup failed');
      error.value = msg;
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout(): void {
    token.value = null;
    localStorage.removeItem('jwt_token');
  }

  function getToken(): string | null {
    return token.value;
  }

  // Clear stale token when auth is disabled
  watch(token, (t) => {
    if (t && !parseJwt(t)) {
      token.value = null;
      localStorage.removeItem('jwt_token');
    }
  });

  return {
    token,
    loading,
    error,
    authEnabled,
    needsSetup,
    isAuthenticated,
    role,
    isAdmin,
    checkAuthEnabled,
    login,
    setup,
    logout,
    getToken,
  };
});
