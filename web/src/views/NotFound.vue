<template>
  <div class="flex flex-col items-center justify-center py-24 text-foreground-muted">
    <Icon icon="mdi:alert-circle-outline" aria-hidden="true" class="mb-4 text-6xl opacity-30" />
    <h1 class="mb-2 text-2xl font-bold text-foreground">页面未找到</h1>
    <p class="mb-6 text-sm">您访问的页面不存在或已被移除</p>
    <BaseButton variant="secondary" @click="$router.push('/')">
      返回首页
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import BaseButton from '../components/common/BaseButton.vue';
</script>
