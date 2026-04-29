<template>
  <div
    class="rounded-xl bg-surface-card"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ hoverable?: boolean }>(), { hoverable: false });
</script>
