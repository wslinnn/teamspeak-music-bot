<template>
  <!-- REST API key 管理：仅交互会话可调（后端拒绝 key 认证自管理）；
       设置页整页 blockGuest，区块天然仅成员/管理员可见。 -->
  <div class="rounded-[var(--radius-lg)] bg-surface-card p-5">
    <div class="flex items-center gap-3">
      <Icon icon="mdi:key-variant" class="text-2xl text-primary shrink-0" />
      <div class="min-w-0">
        <div class="text-sm font-semibold">API 密钥</div>
        <p class="text-xs text-text-tertiary mt-0.5 leading-relaxed">
          通过 API Key 调用本机的 REST API（请求头
          <code class="px-1 py-0.5 rounded bg-bg-primary text-[11px]">Authorization: Bearer</code> 或
          <code class="px-1 py-0.5 rounded bg-bg-primary text-[11px]">X-API-Key</code>）。
          权限与你的账户一致；明文只在生成时显示一次，之后仅能看到前缀。
          完整接口清单见仓库 <code class="px-1 py-0.5 rounded bg-bg-primary text-[11px]">docs/API.md</code>。
        </p>
      </div>
    </div>

    <div class="mt-4 flex flex-col gap-1">
      <div
        v-for="k in keys"
        :key="k.id"
        class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 transition-colors hover:bg-interactive-hover"
      >
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">{{ k.name }}</div>
          <div class="flex flex-wrap gap-x-3 text-xs text-text-tertiary mt-0.5">
            <code class="text-text-secondary">{{ k.keyPrefix }}…</code>
            <span>创建于 {{ formatDate(k.createdAt) }}</span>
            <span>{{ k.lastUsedAt ? `最后使用 ${formatDate(k.lastUsedAt)}` : '从未使用' }}</span>
          </div>
        </div>
        <button
          class="shrink-0 p-1.5 rounded-md text-text-tertiary transition-colors hover:text-red-500 hover:bg-red-500/10"
          title="吊销此密钥"
          @click="revoke(k)"
        >
          <Icon icon="mdi:delete" />
        </button>
      </div>
      <div v-if="keys.length === 0 && !loadError" class="text-xs text-text-tertiary py-2">还没有 API Key。</div>
      <div v-if="loadError" class="text-xs text-red-500">{{ loadError }}</div>
    </div>

    <form class="mt-3 flex gap-2" @submit.prevent="create">
      <input
        v-model="newName"
        class="input flex-1"
        placeholder="密钥名称（如：home-assistant）"
        maxlength="64"
        required
      />
      <BaseButton type="submit" :loading="creating">生成密钥</BaseButton>
    </form>
  </div>

  <!-- 明文一次性展示：关闭即丢，仅能看到前缀 -->
  <BaseModal :model-value="created !== null" title="密钥已生成" @update:model-value="created = null">
    <p class="text-sm">
      密钥「{{ created?.key.name }}」已生成。请立即复制保存——这串明文只显示这一次，
      关闭后只能看到前缀。
    </p>
    <div class="mt-3 flex items-center gap-2">
      <code class="flex-1 min-w-0 break-all text-xs bg-bg-primary rounded-[var(--radius-md)] px-3 py-2 select-all">{{ created?.rawKey }}</code>
      <BaseButton variant="secondary" size="sm" @click="copyCreated">
        <Icon icon="mdi:content-copy" />
        复制
      </BaseButton>
    </div>
    <p class="mt-2 text-xs text-text-tertiary">
      建议保存到密码管理器；注意浏览器扩展可能读取页面内容，敏感环境请手动转录。
    </p>
    <p v-if="copied" class="mt-2 text-xs text-success">已复制到剪贴板</p>
    <template #footer>
      <BaseButton @click="created = null">完成</BaseButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import BaseButton from '../common/BaseButton.vue';
import BaseModal from '../common/BaseModal.vue';

interface ApiKeyEntry {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const toast = useToast();

const keys = ref<ApiKeyEntry[]>([]);
const loadError = ref('');
const newName = ref('');
const creating = ref(false);
const created = ref<{ key: ApiKeyEntry; rawKey: string } | null>(null);
const copied = ref(false);

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function load() {
  loadError.value = '';
  try {
    const res = await http.get('/api/keys');
    keys.value = res.data?.keys ?? [];
  } catch {
    loadError.value = 'API Key 列表加载失败';
  }
}

async function create() {
  const name = newName.value.trim();
  if (!name || creating.value) return;
  creating.value = true;
  try {
    const res = await http.post('/api/keys', { name });
    created.value = res.data;
    copied.value = false;
    newName.value = '';
    await load();
  } catch {
    // 409（数量上限等）等错误文案由 http 拦截器统一提示
  } finally {
    creating.value = false;
  }
}

async function copyCreated() {
  if (!created.value) return;
  try {
    await navigator.clipboard.writeText(created.value.rawKey);
    copied.value = true;
  } catch {
    toast.error('复制失败，请手动选择复制');
  }
}

async function revoke(k: ApiKeyEntry) {
  if (!window.confirm(`确认吊销 API Key「${k.name}」？使用它的集成将立即失效。`)) return;
  try {
    await http.delete(`/api/keys/${k.id}`);
    toast.success(`已吊销「${k.name}」`);
    await load();
  } catch {
    // 错误文案由 http 拦截器统一提示
  }
}

onMounted(load);
</script>
