<template>
  <!-- 管理员维护的音乐账号池（per-user music accounts）。
       凭据只在服务端；此界面仅显示 cookiePreview。 -->
  <div class="rounded-[var(--radius-lg)] bg-surface-card p-5">
    <div class="flex items-center gap-3">
      <Icon icon="mdi:account-supervisor" class="text-2xl text-primary shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">音乐账号池</div>
        <div class="text-xs mt-0.5 text-text-tertiary">
          <template v-if="disabled">
            功能未启用 — 先在 设置 → 行为设置 打开「音乐账号池」
          </template>
          <template v-else>集中管理可分配给成员的平台账号（{{ accounts.length }} 个）</template>
        </div>
      </div>
      <BaseButton v-if="!disabled" variant="secondary" size="sm" @click="openCreate">
        <Icon icon="mdi:plus" />
        添加账号
      </BaseButton>
    </div>

    <!-- The server 403s every route while the feature is off; say so instead of
         rendering an empty pool with a toast that reads like a network error. -->
    <div v-if="disabled" class="mt-4 rounded-[var(--radius-md)] bg-surface-elevated px-4 py-3 text-xs text-text-secondary">
      账号池的后端接口在功能关闭时不可用。打开开关后本区块会自动刷新。
    </div>

    <template v-else>
    <p class="text-xs text-text-tertiary mt-3 leading-relaxed">
      成员可在自己的账号、此处分配的账号、或共享账号之间选择；<strong class="text-text-secondary">房间播放永远使用共享账号</strong>。
      容量 0=不限、1=独占、N=最多分配 N 人。凭据仅存服务器，界面只显示掩码。
    </p>

    <!-- Create / edit form -->
    <form v-if="form.open" class="mt-4 rounded-[var(--radius-md)] bg-surface-elevated p-4" @submit.prevent="save">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1 text-xs">
          平台
          <select v-model="form.platform" :disabled="form.id !== null" class="rounded-[var(--radius-sm)] bg-surface-card px-3 py-2 text-sm text-foreground">
            <option v-for="p in platforms" :key="p" :value="p">{{ platformLabel(p) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs">
          名称
          <input v-model="form.label" class="rounded-[var(--radius-sm)] bg-surface-card px-3 py-2 text-sm text-foreground" placeholder="例如：房间VIP" />
        </label>
        <label class="flex flex-col gap-1 text-xs sm:col-span-2">
          Cookie{{ form.id !== null ? '（留空则不修改）' : '' }}
          <input
            v-model="form.cookie"
            type="password"
            class="rounded-[var(--radius-sm)] bg-surface-card px-3 py-2 text-sm text-foreground"
            placeholder="粘贴 Cookie 或整条 Set-Cookie"
            :required="form.id === null"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs">
          容量
          <input v-model.number="form.capacity" type="number" min="0" class="rounded-[var(--radius-sm)] bg-surface-card px-3 py-2 text-sm text-foreground" />
        </label>
        <label class="flex items-center gap-2 text-xs mt-5">
          <input v-model="form.enabled" type="checkbox" class="accent-[var(--color-primary)]" />
          启用（关闭即立刻收回所有分配）
        </label>
      </div>
      <div class="flex gap-2 mt-4">
        <BaseButton type="submit" size="sm" :loading="form.saving">{{ form.id === null ? '创建' : '保存' }}</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="form.open = false">取消</BaseButton>
      </div>
    </form>

    <!-- Account list -->
    <div v-if="accounts.length === 0" class="text-xs text-text-tertiary mt-4">还没有账号。</div>
    <div v-else class="flex flex-col gap-2 mt-4">
      <div
        v-for="a in accounts"
        :key="a.id"
        class="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-surface-elevated px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium">{{ a.label || '(未命名)' }}</span>
            <span class="text-[10px] px-[5px] py-px rounded-[3px] bg-primary/15 text-primary">{{ platformLabel(a.platform) }}</span>
            <span v-if="!a.enabled" class="text-[10px] px-[5px] py-px rounded-[3px] bg-danger/15 text-danger">已停用</span>
          </div>
          <div class="text-xs text-text-tertiary mt-0.5">
            {{ a.cookiePreview }} · 占用 {{ a.grantCount }}/{{ a.capacity === 0 ? '∞' : a.capacity }}
          </div>
        </div>
        <button class="text-lg p-1 opacity-70 hover:opacity-100" title="编辑" @click="openEdit(a)">
          <Icon icon="mdi:pencil" />
        </button>
        <button class="text-lg p-1 opacity-70 hover:opacity-100 text-danger" title="删除" @click="remove(a)">
          <Icon icon="mdi:delete-outline" />
        </button>
      </div>
    </div>

    <!-- Assignments -->
    <div v-if="accounts.length > 0" class="mt-6">
      <div class="text-sm font-semibold mb-2">分配给成员</div>
      <p class="text-xs text-text-tertiary mb-3">
        被分配的成员可在设置里看到账号名称，但看不到凭据，也不能自行解绑。
      </p>
      <div class="flex flex-col gap-2">
        <div
          v-for="a in assignable"
          :key="a.id"
          class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-surface-elevated px-4 py-3"
        >
          <span class="text-xs shrink-0">{{ a.label || `#${a.id}` }}（{{ platformLabel(a.platform) }}）</span>
          <input
            v-model="a.assignTo"
            class="flex-1 min-w-[140px] rounded-[var(--radius-sm)] bg-surface-card px-3 py-1.5 text-xs text-foreground"
            placeholder="成员用户名或 ID"
          />
          <BaseButton size="sm" variant="secondary" :loading="assigning === a.id" @click="assign(a)">分配</BaseButton>
        </div>
      </div>

      <div v-if="grants.length > 0" class="mt-3 flex flex-col gap-1">
        <div v-for="g in grants" :key="`${g.userId}-${g.platform}`" class="flex items-center gap-2 text-xs text-text-tertiary">
          <Icon icon="mdi:account-arrow-right" />
          <span>{{ g.userId }} → #{{ g.accountId }}（{{ platformLabel(g.platform) }}）</span>
          <button class="text-danger hover:underline" @click="revoke(g)">撤销</button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { getProviderLabel } from '../../utils/platform';
import BaseButton from '../common/BaseButton.vue';

interface AccountRow {
  id: number;
  platform: string;
  label: string;
  cookiePreview: string;
  capacity: number;
  enabled: boolean;
  grantCount: number;
  assignTo?: string;
}

interface GrantRow {
  userId: string;
  platform: string;
  accountId: number;
}

const toast = useToast();
const accounts = ref<AccountRow[]>([]);
const grants = ref<GrantRow[]>([]);
const platforms = ref<string[]>(['netease', 'qq', 'kugou', 'bilibili']);
const assigning = ref<number | null>(null);
/** The server 403s this whole router while perUserMusicAccounts is off. */
const disabled = ref(false);

function platformLabel(platform: string): string {
  return getProviderLabel(platform);
}

const form = reactive({
  open: false,
  id: null as number | null,
  platform: 'netease',
  label: '',
  cookie: '',
  capacity: 0,
  enabled: true,
  saving: false,
});

const assignable = computed(() => accounts.value.filter((a) => a.enabled));

async function refresh() {
  try {
    const res = await http.get('/api/music-accounts');
    accounts.value = res.data?.accounts ?? [];
    grants.value = res.data?.grants ?? [];
    disabled.value = false;
  } catch (err: any) {
    // 403 + this code means the feature flag is off, which is a normal state —
    // not a load failure, and definitely not an empty pool.
    if (err?.response?.status === 403 && err.response?.data?.code === 'per_user_accounts_disabled') {
      disabled.value = true;
      accounts.value = [];
      grants.value = [];
      return;
    }
    toast.error('加载账号池失败');
  }
}

function openCreate() {
  Object.assign(form, {
    open: true,
    id: null,
    platform: platforms.value[0] ?? 'netease',
    label: '',
    cookie: '',
    capacity: 0,
    enabled: true,
  });
}

function openEdit(a: AccountRow) {
  Object.assign(form, {
    open: true,
    id: a.id,
    platform: a.platform,
    label: a.label,
    // Never prefill the credential: the server only ever sent a preview.
    cookie: '',
    capacity: a.capacity,
    enabled: a.enabled,
  });
}

async function save() {
  if (form.saving) return;
  form.saving = true;
  try {
    if (form.id === null) {
      await http.post('/api/music-accounts', {
        platform: form.platform,
        label: form.label,
        cookie: form.cookie,
        capacity: form.capacity,
        enabled: form.enabled,
      });
      toast.success('账号已添加');
    } else {
      const patch: Record<string, unknown> = {
        label: form.label,
        capacity: form.capacity,
        enabled: form.enabled,
      };
      if (form.cookie.trim()) patch.cookie = form.cookie;
      await http.patch(`/api/music-accounts/${form.id}`, patch);
      toast.success('账号已更新');
    }
    form.open = false;
    await refresh();
  } catch (err: any) {
    // 409 carries a human-readable message from the router
    toast.error(err?.response?.data?.error ?? '保存失败');
  } finally {
    form.saving = false;
  }
}

async function remove(a: AccountRow) {
  if (!window.confirm(`删除账号「${a.label || a.id}」？分配给它的成员会立刻回到共享账号。`)) return;
  try {
    await http.delete(`/api/music-accounts/${a.id}`);
    toast.success('已删除');
    await refresh();
  } catch {
    toast.error('删除失败');
  }
}

async function assign(a: AccountRow) {
  const userId = (a.assignTo ?? '').trim();
  if (!userId) {
    toast.warning('请填写成员用户名或 ID');
    return;
  }
  assigning.value = a.id;
  try {
    await http.put(`/api/music-accounts/${a.id}/grants/${encodeURIComponent(userId)}`);
    toast.success('已分配');
    a.assignTo = '';
    await refresh();
  } catch (err: any) {
    toast.error(err?.response?.data?.error ?? '分配失败');
  } finally {
    assigning.value = null;
  }
}

async function revoke(g: GrantRow) {
  try {
    await http.delete(`/api/music-accounts/${g.accountId}/grants/${encodeURIComponent(g.userId)}`);
    toast.success('已撤销分配');
    await refresh();
  } catch {
    toast.error('撤销失败');
  }
}

onMounted(async () => {
  try {
    const res = await http.get('/api/music-accounts/platforms');
    if (Array.isArray(res.data?.platforms) && res.data.platforms.length > 0) {
      platforms.value = res.data.platforms;
    }
  } catch {
    // keep the built-in default list
  }
  await refresh();
});
</script>
