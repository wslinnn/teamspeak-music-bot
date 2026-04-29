<template>
  <div class="flex items-end gap-[3px] h-4">
    <div
      class="w-[3px] rounded-sm bg-primary"
      :class="{ 'animate-bar1': isPlaying, 'h-1': !isPlaying }"
      :style="isPlaying ? {} : { height: '4px' }"
    />
    <div
      class="w-[3px] rounded-sm bg-primary"
      :class="{ 'animate-bar2': isPlaying, 'h-1': !isPlaying }"
      :style="isPlaying ? {} : { height: '4px' }"
    />
    <div
      class="w-[3px] rounded-sm bg-primary"
      :class="{ 'animate-bar3': isPlaying, 'h-1': !isPlaying }"
      :style="isPlaying ? {} : { height: '4px' }"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ isPlaying: boolean }>();
</script>

<style scoped>
@keyframes bar-bounce {
  0%, 100% { height: 4px; }
  50% { height: 16px; }
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
