import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

let idCounter = 0;

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([]);

  function add(message: string, type: ToastType = 'info', duration = 3000) {
    const id = `${Date.now()}-${++idCounter}`;
    items.value.push({ id, message, type, duration });
  }

  function remove(id: string) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, add, remove };
});
