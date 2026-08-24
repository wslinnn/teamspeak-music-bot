import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { http } from '../utils/http';

export const useAuthStore = defineStore('auth', () => {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const authEnabled = ref<boolean | null>(null);
  const needsSetup = ref<boolean | null>(null);
  const role = ref<'admin' | 'user' | null>(null);
  let checkPromise: Promise<boolean> | null = null;

  const isAuthenticated = computed(() => role.value !== null);
  const isAdmin = computed(() => role.value === 'admin');
  const isUser = computed(() => role.value === 'user');

  async function checkAuthEnabled(): Promise<boolean> {
    if (checkPromise) return checkPromise;

    checkPromise = (async () => {
      try {
        const res = await http.get('/api/health');
        authEnabled.value = res.data.authEnabled === true;
        needsSetup.value = res.data.needsSetup === true;

        // Restore session from HTTP-only cookie if auth is enabled
        if (authEnabled.value) {
          try {
            const meRes = await http.get('/api/auth/me');
            role.value = meRes.data.role ?? null;
          } catch (meErr: unknown) {
            const meStatus = (meErr as any)?.response?.status;
            if (meStatus && meStatus !== 401) {
              console.warn('Failed to fetch user:', meErr);
            }
            role.value = null;
          }
        }

        return authEnabled.value;
      } catch (err: unknown) {
        const status = (err as any)?.response?.status;
        if (!status) throw err;
        authEnabled.value = false;
        needsSetup.value = false;
        return false;
      } finally {
        checkPromise = null;
      }
    })();

    return checkPromise;
  }

  async function login(password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/auth/login', { password });
      if (res.data.success) {
        role.value = res.data.role;
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

  async function setup(adminPassword: string, userPassword: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/setup', { adminPassword, userPassword });
      if (res.data.success) {
        needsSetup.value = false;
        authEnabled.value = true;
        return await login(adminPassword);
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
    role.value = null;
    http.post('/api/auth/logout').catch(() => {});
  }

  return {
    loading,
    error,
    authEnabled,
    needsSetup,
    isAuthenticated,
    role,
    isAdmin,
    isUser,
    checkAuthEnabled,
    login,
    setup,
    logout,
  };
});
