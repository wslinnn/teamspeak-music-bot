import axios, { type AxiosInstance } from 'axios';
import { useToastStore } from '../stores/toast';
import { useAuthStore } from '../stores/auth';

export const http: AxiosInstance = axios.create({
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    const token = authStore.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const authStore = useAuthStore();
      authStore.logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const toastStore = useToastStore();
    const message = error.response?.data?.error ?? error.message ?? '请求失败';
    toastStore.add(message, 'error', 4000);

    return Promise.reject(error);
  }
);
