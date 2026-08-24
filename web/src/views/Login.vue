<template>
  <div class="flex min-h-screen items-center justify-center bg-surface">
    <div class="w-full max-w-[400px] rounded-xl bg-surface-elevated p-10 shadow-xl">
      <h1 class="mb-2 text-center text-[28px] font-bold text-foreground">TSMusicBot</h1>
      <p class="mb-8 text-center text-sm text-foreground-muted">请输入用户名和密码登录</p>
      <form @submit.prevent="handleLogin" class="flex flex-col gap-4">
        <input
          v-model="username"
          type="text"
          aria-label="用户名"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="用户名"
          autocomplete="username"
          :disabled="authStore.loading"
          autofocus
        />
        <input
          v-model="password"
          type="password"
          aria-label="密码"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="密码"
          autocomplete="current-password"
          :disabled="authStore.loading"
        />
        <p v-if="authStore.error" role="alert" class="text-sm text-danger">{{ authStore.error }}</p>
        <BaseButton type="submit" :loading="authStore.loading" :disabled="!username || !password" class="w-full">
          登录
        </BaseButton>
        <button
          v-if="authStore.guestAllowed"
          type="button"
          class="text-sm text-foreground-muted transition-colors hover:text-primary disabled:opacity-60"
          :disabled="authStore.loading"
          @click="handleGuest"
        >
          以游客身份进入
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import BaseButton from '../components/common/BaseButton.vue';

const router = useRouter();
const authStore = useAuthStore();
const username = ref('');
const password = ref('');

async function handleLogin() {
  const success = await authStore.login(username.value, password.value);
  if (success) {
    const redirect = (router.currentRoute.value.query.redirect as string) || '/';
    router.push(redirect);
  }
}

async function handleGuest() {
  const success = await authStore.loginGuest();
  if (success) {
    router.push('/');
  }
}
</script>
