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
            title="编辑细粒度权限（能力 + 机器人白名单）"
            @click="openPerms(u)"
          >权限</button>
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

    <!-- Per-user permissions modal（仅成员；admin 恒全量、游客无此概念） -->
    <BaseModal v-model="permsOpen" :title="`权限：${permsTarget?.username ?? ''}`">
      <div v-if="permsLoading" class="py-4">
        <SkeletonLoader height="24px" class="mb-2" />
        <SkeletonLoader height="24px" class="mb-2" />
        <SkeletonLoader height="24px" />
      </div>
      <div v-else class="space-y-5">
        <div>
          <div class="text-xs font-semibold opacity-70 mb-2">能力</div>
          <div class="flex flex-col gap-1.5">
            <label v-for="cap in CAPABILITY_DEFS" :key="cap.token" class="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-hover-bg cursor-pointer">
              <input
                type="checkbox"
                class="accent-[var(--color-primary)] w-4 h-4"
                :checked="permDraft.capabilities.includes(cap.token)"
                @change="toggleCapability(cap.token, ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm">{{ cap.label }}</span>
            </label>
          </div>
          <p class="text-xs text-text-tertiary mt-1.5">取消全部能力后该成员只能浏览，无法执行任何操作</p>
        </div>
        <div>
          <div class="text-xs font-semibold opacity-70 mb-2">可控机器人</div>
          <label class="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-hover-bg cursor-pointer">
            <input
              type="checkbox"
              class="accent-[var(--color-primary)] w-4 h-4"
              v-model="permDraft.botsAll"
            />
            <span class="text-sm">全部机器人（含将来新增）</span>
          </label>
          <div v-if="!permDraft.botsAll" class="flex flex-col gap-1.5 mt-1 ml-4">
            <label v-for="bot in bots" :key="bot.id" class="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-hover-bg cursor-pointer">
              <input
                type="checkbox"
                class="accent-[var(--color-primary)] w-4 h-4"
                :checked="permDraft.selectedBotIds.includes(bot.id)"
                @change="toggleBotSelection(bot.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-sm truncate">{{ bot.name }}</span>
              <span class="w-2 h-2 rounded-full shrink-0" :class="bot.connected ? 'bg-success' : 'bg-text-tertiary'" />
            </label>
            <p v-if="bots.length === 0" class="text-xs text-text-tertiary px-3">还没有机器人</p>
          </div>
        </div>
        <p v-if="permsError" class="text-xs text-red-500">{{ permsError }}</p>
      </div>
      <template #footer="{ close }">
        <BaseButton variant="secondary" @click="close">取消</BaseButton>
        <BaseButton :loading="permsSaving" :disabled="permsLoading" @click="savePerms">保存</BaseButton>
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
import { usePlayerStore } from '../../stores/player';
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
const playerStore = usePlayerStore();
const bots = computed(() => playerStore.bots);

const users = ref<UserRow[]>([]);
const loading = ref(true);
const saving = ref(false);

const createOpen = ref(false);
const createForm = reactive({ username: '', password: '', asAdmin: false });
const resetOpen = ref(false);
const resetTarget = ref<UserRow | null>(null);
const resetPassword = ref('');

// ── 按用户细粒度权限编辑器（D9）：能力矩阵 + bot 白名单，读写 /api/users/:id/permissions ──
const CAPABILITY_DEFS = [
  { token: 'player.control', label: '播放控制（播放/暂停/切歌/音量/进度）' },
  { token: 'player.queue', label: '队列管理（加队列/移除单曲）' },
  { token: 'bot.manage', label: '机器人管理' },
  { token: 'platform.auth', label: '平台登录凭据' },
  { token: 'quality', label: '音质设置' },
];

const permsOpen = ref(false);
const permsTarget = ref<UserRow | null>(null);
const permsLoading = ref(false);
const permsSaving = ref(false);
const permsError = ref('');
const permDraft = reactive<{ capabilities: string[]; botsAll: boolean; selectedBotIds: string[] }>({
  capabilities: [],
  botsAll: true,
  selectedBotIds: [],
});

async function openPerms(u: UserRow) {
  permsTarget.value = u;
  permsError.value = '';
  permsLoading.value = true;
  permsOpen.value = true;
  permDraft.capabilities = [];
  permDraft.botsAll = true;
  permDraft.selectedBotIds = [];
  try {
    const res = await http.get(`/api/users/${u.id}/permissions`);
    permDraft.capabilities = Array.isArray(res.data.capabilities) ? [...res.data.capabilities] : [];
    if (res.data.bots === 'all') {
      permDraft.botsAll = true;
      permDraft.selectedBotIds = [];
    } else {
      permDraft.botsAll = false;
      permDraft.selectedBotIds = Array.isArray(res.data.bots) ? [...res.data.bots] : [];
    }
  } catch (err: unknown) {
    permsError.value = (err as any)?.response?.data?.error ?? '读取权限失败';
  } finally {
    permsLoading.value = false;
  }
}

function toggleCapability(token: string, checked: boolean) {
  const has = permDraft.capabilities.includes(token);
  if (checked && !has) permDraft.capabilities.push(token);
  else if (!checked && has) permDraft.capabilities = permDraft.capabilities.filter((t) => t !== token);
}

function toggleBotSelection(id: string, checked: boolean) {
  const has = permDraft.selectedBotIds.includes(id);
  if (checked && !has) permDraft.selectedBotIds.push(id);
  else if (!checked && has) permDraft.selectedBotIds = permDraft.selectedBotIds.filter((b) => b !== id);
}

async function savePerms() {
  if (!permsTarget.value) return;
  permsSaving.value = true;
  permsError.value = '';
  try {
    await http.put(`/api/users/${permsTarget.value.id}/permissions`, {
      capabilities: [...permDraft.capabilities],
      bots: permDraft.botsAll ? 'all' : [...permDraft.selectedBotIds],
    });
    toast.success(`已保存 ${permsTarget.value.username} 的权限`);
    permsOpen.value = false;
  } catch (err: unknown) {
    permsError.value = (err as any)?.response?.data?.error ?? '保存权限失败';
  } finally {
    permsSaving.value = false;
  }
}

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
