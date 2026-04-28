import { useToastStore } from '../stores/toast.js';

export function useToast() {
  const store = useToastStore();

  return {
    success: (message: string, duration?: number) => store.add(message, 'success', duration),
    error: (message: string, duration?: number) => store.add(message, 'error', duration),
    warning: (message: string, duration?: number) => store.add(message, 'warning', duration),
    info: (message: string, duration?: number) => store.add(message, 'info', duration),
  };
}
