import axios, { type AxiosInstance } from 'axios';
import { useToastStore } from '../stores/toast';
import { useAuthStore } from '../stores/auth';

export const http: AxiosInstance = axios.create({
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// 会话相关端点自行处理 401（登录失败内联提示 / 初始化流程引导 / 改密码旧密码校验），不走全局跳转与全局 toast
const selfHandled401 = new Set([
  '/api/session/needs-setup',
  '/api/session/me',
  '/api/session/login',
  '/api/session/guest',
  '/api/session/setup',
  '/api/session/change-password',
]);

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (selfHandled401.has(error.config?.url ?? '')) {
        return Promise.reject(error);
      }
      const authStore = useAuthStore();
      authStore.clearSession();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    const toastStore = useToastStore();
    const message = error.response?.data?.error ?? error.message ?? '请求失败';
    toastStore.add(message, 'error', 4000);

    return Promise.reject(error);
  }
);
