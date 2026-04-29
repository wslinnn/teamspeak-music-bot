import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { http } from '../utils/http';

function parseJwt(token: string): { role?: string } | null {
  try {
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('jwt_token'));
  const username = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  const authEnabled = ref<boolean | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  const role = computed(() => {
    if (!token.value) return null;
    return parseJwt(token.value)?.role ?? null;
  });

  const isAdmin = computed(() => role.value === 'admin');

  async function checkAuthEnabled(): Promise<boolean> {
    try {
      const res = await http.get('/api/health');
      authEnabled.value = res.data.authEnabled === true;
      return authEnabled.value;
    } catch (err: unknown) {
      const status = (err as any)?.response?.status;
      if (!status) throw err;
      authEnabled.value = false;
      return false;
    }
  }

  async function login(password: string, user?: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/auth/login', {
        password,
        username: user || undefined,
      });
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

  function logout(): void {
    token.value = null;
    localStorage.removeItem('jwt_token');
  }

  function getToken(): string | null {
    return token.value;
  }

  return {
    token,
    username,
    loading,
    error,
    authEnabled,
    isAuthenticated,
    role,
    isAdmin,
    checkAuthEnabled,
    login,
    logout,
    getToken,
  };
});
