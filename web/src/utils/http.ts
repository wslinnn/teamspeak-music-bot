import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { useToastStore } from '../stores/toast';
import { useAuthStore } from '../stores/auth';

// 允许单个请求声明"错误自行处理，不要全局 toast"（如 avatar 404 = 未设置，是正常态）
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean;
  }
}

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

// 审计 C7：预期内的失败不弹全局 toast——这些是只读装饰性数据，未登录/
// 未启用属于正常态，由视图展示空态（上游本就由视图自行决定是否提示）。
const expectedFailurePatterns: RegExp[] = [
  /\/api\/player\/[^/]+\/history$/,      // 游客 403 = 正常态
  /\/api\/music\/user\/playlists(\?|$)/, // 未登录音源
  /\/api\/auth\/status(\?|$)/,           // 未配置平台
];

function isExpectedFailure(url: string): boolean {
  return expectedFailurePatterns.some((re) => re.test(url));
}

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
        // 审计 B5：携带回跳参数，登录后回到原页面（Login.vue 已有防开放重定向校验）
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${next}`;
      }
      return Promise.reject(error);
    }

    const toastStore = useToastStore();
    const message = error.response?.data?.error ?? error.message ?? '请求失败';
    if (!error.config?.skipErrorToast && !isExpectedFailure(error.config?.url ?? '')) {
      toastStore.add(message, 'error', 4000);
    }

    return Promise.reject(error);
  }
);
