<template>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm font-medium min-w-0">
      <Icon icon="mdi:account-circle-outline" class="text-lg opacity-60 shrink-0" />
      <span class="truncate">
        {{ auth.user?.username ?? '未登录' }}<span class="text-text-tertiary font-normal"> · {{ roleLabel }}</span>
      </span>
    </div>
    <BaseButton variant="secondary" size="sm" @click="handleLogout">退出登录</BaseButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useAuthStore } from '../../stores/auth';
import BaseButton from '../common/BaseButton.vue';

// 移动端导航栏没有账号入口（桌面走导航栏下拉），设置页提供唯一的退出通道
const auth = useAuthStore();

const roleLabel = computed(() => {
  const role = auth.user?.role;
  if (role === 'admin') return '管理员';
  if (role === 'guest') return '游客';
  if (role === 'member') return '成员';
  return role ?? '';
});

function handleLogout() {
  // 整页重载回登录页：与登录流程对齐，应用以未登录状态完整重建
  auth.logout();
  window.location.replace('/login');
}
</script>
