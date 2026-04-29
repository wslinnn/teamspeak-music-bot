<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">TSMusicBot</h1>
      <p class="login-subtitle">请输入管理密码</p>
      <form @submit.prevent="handleLogin">
        <input
          v-model="password"
          type="password"
          class="login-input"
          placeholder="管理密码"
          autocomplete="current-password"
          :disabled="authStore.loading"
          autofocus
        />
        <p v-if="authStore.error" class="login-error">{{ authStore.error }}</p>
        <button type="submit" class="login-btn" :disabled="authStore.loading || !password">
          {{ authStore.loading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const authStore = useAuthStore();
const password = ref('');

async function handleLogin() {
  const success = await authStore.login(password.value);
  if (success) {
    const redirect = (router.currentRoute.value.query.redirect as string) || '/';
    router.push(redirect);
  }
}
</script>

<style scoped lang="scss">
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-primary);
}

.login-card {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 48px 40px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.login-title {
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.login-subtitle {
  text-align: center;
  color: var(--text-secondary);
  margin: 0 0 32px;
  font-size: 14px;
}

.login-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 16px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: var(--accent, #6366f1);
  }

  &:disabled {
    opacity: 0.6;
  }
}

.login-error {
  color: #ef4444;
  font-size: 13px;
  margin: 8px 0 0;
}

.login-btn {
  width: 100%;
  padding: 12px;
  margin-top: 20px;
  background: var(--accent, #6366f1);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
