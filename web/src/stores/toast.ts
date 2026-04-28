import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([]);

  function add(message: string, type: ToastType = 'info', duration = 3000): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    items.value.push({ id, message, type, duration });
    return id;
  }

  function remove(id: string) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, add, remove };
});
