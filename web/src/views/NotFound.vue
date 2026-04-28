<template>
  <div class="not-found">
    <div class="not-found-content">
      <h1 class="error-code">404</h1>
      <p class="error-message">页面未找到</p>
      <button class="back-btn" @click="goHome">返回首页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goHome() {
  router.push({ name: 'home' });
}
</script>

<style scoped lang="scss">
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.not-found-content {
  text-align: center;
}

.error-code {
  font-size: 96px;
  font-weight: 700;
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1;
}

.error-message {
  font-size: 18px;
  color: var(--text-secondary);
  margin: 16px 0 32px;
}

.back-btn {
  padding: 10px 24px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  font-size: 14px;
  cursor: pointer;
  transition: background var(--transition-fast, 0.2s ease);

  &:hover {
    background: var(--hover-bg);
  }
}
</style>
