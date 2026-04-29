<template>
  <div
    class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
    :class="typeClasses"
    role="alert"
    aria-atomic="true"
  >
    <Icon :icon="iconName" class="text-lg" />
    <span>{{ item.message }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import type { ToastItem } from '../../stores/toast';

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
    case 'success': return 'bg-success/15 text-success border border-success/20';
    case 'error': return 'bg-danger/15 text-danger border border-danger/20';
    case 'warning': return 'bg-warning/15 text-warning border border-warning/20';
    default: return 'bg-primary/15 text-primary border border-primary/20';
  }
});
</script>
