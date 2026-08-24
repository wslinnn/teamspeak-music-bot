<template>
  <div class="flex min-h-screen items-center justify-center bg-surface">
    <div class="w-full max-w-[400px] rounded-xl bg-surface-elevated p-10 shadow-xl">
      <h1 class="mb-2 text-center text-[28px] font-bold text-foreground">欢迎使用 TSMusicBot</h1>
      <p class="mb-8 text-center text-sm text-foreground-muted">创建首位管理员账号以开始使用</p>
      <form @submit.prevent="handleSetup" class="flex flex-col gap-4">
        <input
          v-model="username"
          type="text"
          aria-label="管理员用户名"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="用户名（3-32 位字母/数字/_-.）"
          autocomplete="username"
          :disabled="authStore.loading"
          autofocus
        />
        <input
          v-model="password"
          type="password"
          aria-label="密码"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="密码（至少 8 位）"
          autocomplete="new-password"
          :disabled="authStore.loading"
        />
        <input
          v-model="confirmPassword"
          type="password"
          aria-label="确认密码"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="确认密码"
          autocomplete="new-password"
          :disabled="authStore.loading"
        />
        <p v-if="localError" role="alert" class="text-sm text-danger">{{ localError }}</p>
        <p v-if="authStore.error" role="alert" class="text-sm text-danger">{{ authStore.error }}</p>
        <BaseButton type="submit" :loading="authStore.loading" :disabled="!canSubmit" class="w-full">
          完成设置
        </BaseButton>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import BaseButton from '../components/common/BaseButton.vue';

const router = useRouter();
const authStore = useAuthStore();
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const localError = ref('');

const canSubmit = computed(() => username.value.length > 0 && password.value.length > 0);

async function handleSetup() {
  localError.value = '';
  if (!/^[A-Za-z0-9_\-.]{3,32}$/.test(username.value)) {
    localError.value = '用户名需 3-32 位字母/数字/_-.';
    return;
  }
  if (password.value.length < 8) {
    localError.value = '密码至少需要 8 个字符';
    return;
  }
  if (password.value !== confirmPassword.value) {
    localError.value = '两次输入的密码不一致';
    return;
  }
  const success = await authStore.setup(username.value, password.value);
  if (success) {
    router.push('/');
  }
}
</script>
