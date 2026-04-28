<template>
  <div
    class="rounded-xl bg-surface-card transition-shadow duration-200"
    :class="{ 'hover:shadow-lg': hoverable }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ hoverable?: boolean }>(), { hoverable: true });
</script>
