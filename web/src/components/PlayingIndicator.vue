<template>
  <div class="flex items-end gap-[3px] h-4">
    <div
      class="w-[3px] h-4 rounded-sm bg-primary origin-bottom"
      :class="{ 'animate-bar1': isPlaying, 'scale-y-[0.25]': !isPlaying }"
    />
    <div
      class="w-[3px] h-4 rounded-sm bg-primary origin-bottom"
      :class="{ 'animate-bar2': isPlaying, 'scale-y-[0.25]': !isPlaying }"
    />
    <div
      class="w-[3px] h-4 rounded-sm bg-primary origin-bottom"
      :class="{ 'animate-bar3': isPlaying, 'scale-y-[0.25]': !isPlaying }"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ isPlaying: boolean }>();
</script>

<style scoped>
@keyframes bar-bounce {
  0%, 100% { transform: scaleY(0.25); }
  50% { transform: scaleY(1); }
}
.animate-bar1 {
  animation: bar-bounce 0.8s ease-in-out infinite;
}
.animate-bar2 {
  animation: bar-bounce 0.8s ease-in-out 0.15s infinite;
}
.animate-bar3 {
  animation: bar-bounce 0.8s ease-in-out 0.3s infinite;
}
</style>
