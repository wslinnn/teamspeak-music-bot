<template>
  <div
    class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
    :class="typeClasses"
    role="alert"
  >
    <Icon :icon="iconName" class="text-lg" />
    <span>{{ item.message }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import type { ToastItem } from '../../stores/toast.js';

const props = defineProps<{ item: ToastItem }>();

const iconName = computed(() => {
  switch (props.item.type) {
    case 'success': return 'mdi:check-circle';
    case 'error': return 'mdi:alert-circle';
    case 'warning': return 'mdi:alert';
    default: return 'mdi:information';
  }
});

const typeClasses = computed(() => {
  switch (props.item.type) {
    case 'success': return 'bg-green-500/15 text-green-500 border border-green-500/20';
    case 'error': return 'bg-red-500/15 text-red-500 border border-red-500/20';
    case 'warning': return 'bg-yellow-500/15 text-yellow-500 border border-yellow-500/20';
    default: return 'bg-blue-500/15 text-blue-500 border border-blue-500/20';
  }
});
</script>
