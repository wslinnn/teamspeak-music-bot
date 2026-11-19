<template>
  <!-- 成员的「网页端播放使用哪个账号」偏好（per-user music accounts）。
       只在管理员开启该功能后渲染——关闭时不占位、不误导。 -->
  <div v-if="visible" class="rounded-[var(--radius-lg)] bg-surface-card p-5">
    <div class="flex items-center gap-3">
      <Icon icon="mdi:account-music" class="text-2xl text-primary shrink-0" />
      <div class="min-w-0">
        <div class="text-sm font-semibold">网页端音乐账号</div>
        <div class="text-xs mt-0.5 text-text-tertiary">
          决定你在网页端搜索、歌单与推荐使用哪个账号
        </div>
      </div>
    </div>

    <p class="text-xs text-text-tertiary mt-3 leading-relaxed">
      房间里播歌<strong class="text-text-secondary">一直使用机器人的共享账号</strong>，无论这里怎么选——
      会员权益属于房间，歌库隔离属于你。
    </p>

    <div class="flex flex-col gap-2 mt-4">
      <label
        v-for="p in rows"
        :key="p.platform"
        class="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-surface-elevated px-4 py-3"
      >
        <span class="w-16 shrink-0 text-sm font-medium">{{ platformLabel(p.platform) }}</span>
        <span class="flex-1 min-w-0 text-xs" :class="activeClass(p)">
          {{ describe(p) }}
        </span>
        <label class="flex items-center gap-2 text-xs shrink-0" :class="{ 'opacity-50': !p.canToggle }">
          <input
            type="checkbox"
            class="accent-[var(--color-primary)]"
            :checked="p.active === 'shared'"
            :disabled="!p.canToggle || saving === p.platform"
            @change="setShared(p, ($event.target as HTMLInputElement).checked)"
          />
          使用共享账号
        </label>
      </label>
    </div>

    <p v-if="rows.length === 0" class="text-xs text-text-tertiary mt-4">暂无可配置的音源。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { getPlatformLabel } from '../../utils/platform';

interface PlatformRow {
  platform: string;
  enabled: boolean;
  linked: boolean;
  preferShared: boolean;
  active: 'shared' | 'own' | 'granted';
  granted: { label: string; enabled: boolean; canUnlink: boolean } | null;
  /** Whether flipping the switch would change anything. */
  canToggle: boolean;
}

const toast = useToast();
const visible = ref(false);
const rows = ref<PlatformRow[]>([]);
const saving = ref<string | null>(null);

function platformLabel(platform: string): string {
  // Reuse the shared label map; unknown platforms fall back to the raw id.
  try {
    return getPlatformLabel(platform as never);
  } catch {
    return platform;
  }
}

function describe(p: PlatformRow): string {
  if (p.active === 'own') return '使用你自己绑定的账号';
  if (p.active === 'granted') {
    const label = p.granted?.label ? `「${p.granted.label}」` : '';
    return p.granted?.enabled === false
      ? `管理员分配的账号${label}已停用，暂时回退到共享账号`
      : `使用管理员分配的账号${label}`;
  }
  return '使用机器人的共享账号';
}

function activeClass(p: PlatformRow): string {
  if (p.active === 'own' || p.active === 'granted') return 'text-success';
  return 'text-text-tertiary';
}

async function refresh() {
  try {
    const res = await http.get('/api/me/music-accounts/status');
    visible.value = Boolean(res.data?.perUserMusicAccounts);
    if (!visible.value) {
      rows.value = [];
      return;
    }
    rows.value = (res.data?.platforms ?? []).map((p: PlatformRow) => ({
      ...p,
      canToggle: p.linked || Boolean(p.granted),
    }));
  } catch {
    visible.value = false;
  }
}

async function setShared(p: PlatformRow, wantShared: boolean) {
  const previous = p.preferShared;
  p.preferShared = wantShared;
  p.active = wantShared ? 'shared' : (p.linked ? 'own' : p.granted ? 'granted' : 'shared');
  saving.value = p.platform;
  try {
    await http.put(`/api/me/music-accounts/${p.platform}/preference`, {
      preferShared: wantShared,
    });
    toast.success(wantShared ? '已切换到共享账号' : '已切回你自己的账号');
  } catch {
    // Roll the optimistic update back so the UI never lies about the state.
    p.preferShared = previous;
    toast.error('切换失败，请稍后重试');
  } finally {
    saving.value = null;
    await refresh();
  }
}

onMounted(refresh);
</script>
