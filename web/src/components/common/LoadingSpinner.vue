<template>
  <div
    role="status"
    aria-label="Loading"
    class="animate-spin rounded-full border-2 border-current border-t-transparent"
    :class="sizeClass"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'md' });

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'w-3 h-3';
    case 'sm': return 'w-4 h-4';
    case 'lg': return 'w-8 h-8';
    default: return 'w-5 h-5';
  }
});
</script>
