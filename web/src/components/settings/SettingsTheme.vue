<template>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm font-medium">
      <Icon icon="mdi:theme-light-dark" class="text-lg opacity-60" />
      主题模式
    </div>
    <BaseButton variant="secondary" size="sm" @click="store.toggleTheme()">
      <Icon :icon="store.theme === 'dark' ? 'mdi:weather-night' : 'mdi:weather-sunny'" class="mr-1" />
      {{ store.theme === 'dark' ? '深色' : '浅色' }}
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player';
import BaseButton from '../common/BaseButton.vue';

const store = usePlayerStore();
</script>
