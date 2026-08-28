<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm font-medium min-w-0">
        <Icon icon="mdi:account-circle-outline" class="text-lg opacity-60 shrink-0" />
        <span class="truncate">
          {{ auth.user?.username ?? '未登录' }}<span class="text-text-tertiary font-normal"> · {{ roleLabel }}</span>
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <BaseButton variant="secondary" size="sm" @click="pwModalOpen = true">修改密码</BaseButton>
        <BaseButton variant="secondary" size="sm" @click="handleLogout">退出登录</BaseButton>
      </div>
    </div>

    <p class="text-xs text-foreground-subtle">修改密码后其他设备的登录会自动注销，当前设备保持登录。</p>

    <BaseModal v-model="pwModalOpen" title="修改密码">
      <form class="space-y-3" @submit.prevent="submitPassword">
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">当前密码</label>
          <input v-model="pwForm.old" type="password" autocomplete="current-password" class="input" required />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">新密码（至少 8 位）</label>
          <input v-model="pwForm.new" type="password" autocomplete="new-password" minlength="8" class="input" required />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">再次输入新密码</label>
          <input v-model="pwForm.confirm" type="password" autocomplete="new-password" minlength="8" class="input" required />
        </div>
        <p v-if="pwError" class="text-xs text-red-500">{{ pwError }}</p>
        <div class="flex justify-end gap-3 pt-2">
          <BaseButton type="button" variant="secondary" @click="pwModalOpen = false">取消</BaseButton>
          <BaseButton type="submit" :disabled="changingPw">{{ changingPw ? '提交中…' : '确认修改' }}</BaseButton>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useAuthStore } from '../../stores/auth';
import { useToast } from '../../composables/useToast';
import BaseButton from '../common/BaseButton.vue';
import BaseModal from '../common/BaseModal.vue';

// 移动端导航栏没有账号入口（桌面走导航栏），设置页提供唯一的退出/改密通道
const auth = useAuthStore();
const toast = useToast();

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

// ── 修改密码 ──
const pwModalOpen = ref(false);
const pwForm = ref({ old: '', new: '', confirm: '' });
const pwError = ref('');
const changingPw = ref(false);

async function submitPassword() {
  pwError.value = '';
  if (pwForm.value.new !== pwForm.value.confirm) {
    pwError.value = '两次输入的新密码不一致';
    return;
  }
  if (pwForm.value.new.length < 8) {
    pwError.value = '新密码至少 8 位';
    return;
  }
  changingPw.value = true;
  try {
    await http.post('/api/session/change-password', {
      oldPassword: pwForm.value.old,
      newPassword: pwForm.value.new,
    });
    pwModalOpen.value = false;
    pwForm.value = { old: '', new: '', confirm: '' };
    toast.success('密码已更新，其他设备的登录已注销');
  } catch (err: unknown) {
    const status = (err as any)?.response?.status;
    if (status === 401) {
      pwError.value = '当前密码不正确';
    } else if (status === 400) {
      pwError.value = '新密码至少 8 位';
    } else {
      pwError.value = (err as any)?.response?.data?.error ?? '修改失败，请稍后再试';
    }
  } finally {
    changingPw.value = false;
  }
}
</script>
