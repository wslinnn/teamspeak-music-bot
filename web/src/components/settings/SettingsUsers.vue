<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <div class="flex items-center gap-2 text-sm font-medium">
          <Icon icon="mdi:account-group" class="text-lg opacity-60" />
          用户管理
        </div>
        <p class="mt-1 text-xs text-foreground-subtle">成员默认拥有全部常规能力；系统会保留至少一位管理员</p>
      </div>
      <BaseButton size="sm" @click="openCreate">新建用户</BaseButton>
    </div>

    <div v-if="loading">
      <SkeletonLoader v-for="n in 3" :key="n" height="56px" class="mb-2" />
    </div>

    <div v-else class="flex flex-col gap-1">
      <div
        v-for="u in users"
        :key="u.id"
        class="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-hover-bg group"
      >
        <Icon
          :icon="u.role === 'admin' ? 'mdi:shield-account' : u.role === 'guest' ? 'mdi:walk' : 'mdi:account'"
          class="text-lg opacity-60 shrink-0"
        />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">
            {{ u.username }}
            <span v-if="u.username === authStore.username" class="text-xs text-foreground-subtle">（我）</span>
          </div>
          <div class="text-xs text-text-tertiary">{{ roleLabel(u.role) }}</div>
        </div>
        <span
          class="shrink-0 text-[10px] font-semibold px-1.5 py-px rounded"
          :class="u.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-interactive-hover text-foreground-muted'"
        >{{ roleLabel(u.role) }}</span>
        <div
          v-if="u.role !== 'guest'"
          class="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        >
          <button
            v-if="u.role === 'member'"
            class="text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-interactive-hover hover:bg-primary hover:text-white transition-colors"
            title="提升为管理员"
            @click="setRole(u, 'admin')"
          >提升</button>
          <button
            v-else-if="u.username !== authStore.username"
            class="text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-interactive-hover hover:bg-primary hover:text-white transition-colors"
            title="降为成员"
            @click="setRole(u, 'member')"
          >降级</button>
          <button
            class="text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-interactive-hover hover:bg-primary hover:text-white transition-colors"
            title="重置密码"
            @click="openReset(u)"
          >重置密码</button>
          <button
            v-if="u.username !== authStore.username"
            class="text-base px-1 text-text-tertiary hover:text-danger transition-colors"
            title="删除用户"
            @click="removeUser(u)"
          >
            <Icon icon="mdi:delete-outline" />
          </button>
        </div>
      </div>
    </div>

    <!-- Create user modal -->
    <BaseModal v-model="createOpen" title="新建用户">
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">用户名（3-32 位字母/数字/_-.）</label>
          <input v-model="createForm.username" class="input" placeholder="用户名" autocomplete="off" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">密码（至少 8 位）</label>
          <input v-model="createForm.password" type="password" class="input" placeholder="密码" autocomplete="new-password" />
        </div>
        <BaseToggle v-model="createForm.asAdmin" label="创建为管理员" hint="关闭则创建为普通成员" />
      </div>
      <template #footer="{ close }">
        <BaseButton variant="secondary" @click="close">取消</BaseButton>
        <BaseButton :loading="saving" :disabled="!canCreate" @click="createUser">创建</BaseButton>
      </template>
    </BaseModal>

    <!-- Reset password modal -->
    <BaseModal v-model="resetOpen" :title="`重置密码：${resetTarget?.username ?? ''}`">
      <div>
        <label class="block text-xs font-semibold opacity-70 mb-1">新密码（至少 8 位）</label>
        <input v-model="resetPassword" type="password" class="input" placeholder="新密码" autocomplete="new-password" />
      </div>
      <template #footer="{ close }">
        <BaseButton variant="secondary" @click="close">取消</BaseButton>
        <BaseButton :loading="saving" :disabled="resetPassword.length < 8" @click="resetPwd">重置</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { useAuthStore } from '../../stores/auth';
import BaseModal from '../common/BaseModal.vue';
import BaseButton from '../common/BaseButton.vue';
import BaseToggle from '../common/BaseToggle.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';

interface UserRow {
  id: string;
  username: string;
  role: 'admin' | 'member' | 'guest';
}

const toast = useToast();
const authStore = useAuthStore();

const users = ref<UserRow[]>([]);
const loading = ref(true);
const saving = ref(false);

const createOpen = ref(false);
const createForm = reactive({ username: '', password: '', asAdmin: false });
const resetOpen = ref(false);
const resetTarget = ref<UserRow | null>(null);
const resetPassword = ref('');

const canCreate = computed(
  () => /^[A-Za-z0-9_\-.]{3,32}$/.test(createForm.username) && createForm.password.length >= 8
);

function roleLabel(role: string): string {
  if (role === 'admin') return '管理员';
  if (role === 'guest') return '游客（系统保留）';
  return '成员';
}

async function load() {
  loading.value = true;
  try {
    const res = await http.get('/api/users');
    users.value = res.data.users ?? [];
  } catch {
    toast.error('读取用户列表失败');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  createForm.username = '';
  createForm.password = '';
  createForm.asAdmin = false;
  createOpen.value = true;
}

async function createUser() {
  saving.value = true;
  try {
    await http.post('/api/users', {
      username: createForm.username,
      password: createForm.password,
      role: createForm.asAdmin ? 'admin' : 'member',
    });
    toast.success(`用户 ${createForm.username} 已创建`);
    createOpen.value = false;
    await load();
  } catch (err) {
    const msg = (err as any)?.response?.data?.error;
    if (msg === 'invalid username or password') {
      toast.error('用户名需 3-32 位字母/数字/_-.，密码至少 8 位');
    }
    // 其余错误（如用户名已占用）由 http 拦截器统一 toast
  } finally {
    saving.value = false;
  }
}

async function setRole(u: UserRow, role: 'admin' | 'member') {
  try {
    await http.patch(`/api/users/${u.id}/role`, { role });
    toast.success(`${u.username} 已${role === 'admin' ? '提升为管理员' : '降为成员'}`);
    await load();
  } catch {
    // 最后一位管理员保护等错误由拦截器 toast
  }
}

function openReset(u: UserRow) {
  resetTarget.value = u;
  resetPassword.value = '';
  resetOpen.value = true;
}

async function resetPwd() {
  if (!resetTarget.value) return;
  saving.value = true;
  try {
    await http.post(`/api/users/${resetTarget.value.id}/reset-password`, {
      newPassword: resetPassword.value,
    });
    toast.success(`已重置 ${resetTarget.value.username} 的密码`);
    resetOpen.value = false;
  } catch {
    // 拦截器 toast
  } finally {
    saving.value = false;
  }
}

async function removeUser(u: UserRow) {
  if (!confirm(`删除用户 "${u.username}"？此操作不可撤销。`)) return;
  try {
    await http.delete(`/api/users/${u.id}`);
    toast.success(`用户 ${u.username} 已删除`);
    await load();
  } catch {
    // 拦截器 toast
  }
}

onMounted(load);
</script>
