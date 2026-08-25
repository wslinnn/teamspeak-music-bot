<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <div class="flex items-center gap-2 text-sm font-medium">
          <Icon icon="mdi:file-document-outline" class="text-lg opacity-60" />
          操作审计
        </div>
        <p class="mt-1 text-xs text-foreground-subtle">用户与权限相关操作的留痕记录（最新在前）</p>
      </div>
      <BaseButton size="sm" :loading="loading" @click="load">刷新</BaseButton>
    </div>

    <div v-if="error" class="text-xs text-red-500 px-3">{{ error }}</div>
    <EmptyState v-else-if="!loading && entries.length === 0" message="暂无操作记录" icon="mdi:file-document-outline-outline" />

    <div v-else class="flex flex-col gap-1">
      <div
        v-for="e in entries"
        :key="e.id"
        class="flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] hover:bg-hover-bg"
      >
        <span class="text-xs text-text-tertiary tabular-nums shrink-0 hidden sm:inline">{{ formatDateTime(e.timestamp) }}</span>
        <span class="text-xs text-text-tertiary tabular-nums shrink-0 sm:hidden">{{ formatDate(e.timestamp) }}</span>
        <span class="text-xs px-1.5 py-px rounded shrink-0"
          :class="e.actorUsername ? 'bg-primary/15 text-primary' : 'bg-interactive-hover text-foreground-muted'"
        >{{ e.actorUsername ?? '系统' }}</span>
        <span class="flex-1 min-w-0 text-sm truncate" :class="actionClass(e.action)">{{ describeAction(e) }}</span>
      </div>
    </div>

    <div v-if="hasMore || offset > 0" class="flex items-center justify-between pt-1">
      <button
        class="text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-interactive-hover hover:bg-primary hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-interactive-hover disabled:hover:text-inherit"
        :disabled="offset === 0 || loading"
        @click="page(-1)"
      >上一页</button>
      <span class="text-xs text-text-tertiary">第 {{ offset / PAGE_SIZE + 1 }} 页</span>
      <button
        class="text-xs px-2 py-1 rounded-[var(--radius-sm)] bg-interactive-hover hover:bg-primary hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-interactive-hover disabled:hover:text-inherit"
        :disabled="!hasMore || loading"
        @click="page(1)"
      >下一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import BaseButton from '../common/BaseButton.vue';
import EmptyState from '../common/EmptyState.vue';

interface AuditEntry {
  id: number;
  timestamp: number;
  actorId: string | null;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  action: string;
}

const PAGE_SIZE = 100;
const entries = ref<AuditEntry[]>([]);
const loading = ref(false);
const error = ref('');
const offset = ref(0);
const hasMore = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await http.get('/api/audit', { params: { limit: PAGE_SIZE, offset: offset.value } });
    entries.value = res.data.entries ?? [];
    hasMore.value = entries.value.length === PAGE_SIZE;
  } catch (err: unknown) {
    error.value = (err as any)?.response?.data?.error ?? '读取审计记录失败';
  } finally {
    loading.value = false;
  }
}

function page(dir: 1 | -1) {
  offset.value = Math.max(0, offset.value + dir * PAGE_SIZE);
  load();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeAction(e: AuditEntry): string {
  const target = e.targetUsername ?? e.targetUserId ?? '—';
  switch (e.action) {
    case 'admin.first_created':      return `创建首位管理员 ${target}`;
    case 'user.created':             return `创建用户 ${target}`;
    case 'user.deleted':             return `删除用户 ${target}`;
    case 'user.password_reset':      return `重置 ${target} 的密码`;
    case 'user.password_changed':    return '修改自己的密码';
    case 'user.role_changed':        return `变更 ${target} 的角色`;
    case 'user.permissions_changed': return `权限变更 → ${target}`;
    default:                         return `${e.action} → ${target}`;
  }
}

function actionClass(action: string): string {
  if (action === 'user.deleted') return 'text-red-500';
  if (action === 'user.password_reset' || action === 'user.password_changed') return 'text-yellow-500';
  return '';
}

onMounted(load);
</script>
