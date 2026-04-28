<template>
  <div
    class="animate-pulse rounded-md bg-foreground-subtle/10"
    :style="computedStyle"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    width?: string;
    height?: string;
    borderRadius?: string;
  }>(),
  { width: '100%', height: '16px', borderRadius: '6px' }
);

const computedStyle = computed(() => ({
  width: props.width,
  height: props.height,
  borderRadius: props.borderRadius,
}));
</script>
