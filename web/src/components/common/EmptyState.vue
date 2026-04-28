<template>
  <div class="flex flex-col items-center justify-center py-16 text-foreground-muted">
    <Icon v-if="icon" :icon="icon" class="mb-4 text-4xl opacity-40" />
    <p class="text-sm">{{ message }}</p>
    <p v-if="description" class="mt-1 text-xs opacity-70">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{
  message: string;
  description?: string;
  icon?: string;
}>();
</script>
