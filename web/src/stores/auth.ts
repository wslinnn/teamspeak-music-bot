import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { http } from '../utils/http.js';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('jwt_token'));
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  async function checkAuthEnabled(): Promise<boolean> {
    try {
      const res = await http.get('/api/health');
      return res.data.authEnabled === true;
    } catch {
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
      const msg = err instanceof Error ? err.message : 'Login failed';
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

  return { token, loading, error, isAuthenticated, login, logout, getToken, checkAuthEnabled };
});
