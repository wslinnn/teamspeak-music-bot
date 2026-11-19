<template>
  <!-- 当前登录用户自己的平台账号（#164）。
       设置页整页 blockGuest，本区块天然只对成员/管理员可见。 -->
  <div class="rounded-[var(--radius-lg)] bg-surface-card p-5">
    <div class="flex items-center gap-3">
      <Icon icon="mdi:account-music" class="text-2xl text-primary shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">我的音乐账号</div>
        <div class="text-xs mt-0.5" :class="current.loggedIn ? 'text-success' : 'text-text-tertiary'">
          <template v-if="current.loggedIn">已绑定：{{ current.nickname || platformLabel(activePlatform) }}</template>
          <template v-else-if="current.linked">已绑定，但登录已失效，请重新扫码</template>
          <template v-else>未绑定 — 使用机器人的共享账号</template>
        </div>
      </div>
    </div>

    <!-- 平台切换：只列出后端支持自助登录的平台 -->
    <div v-if="available.length > 1" class="flex flex-wrap gap-2 mt-4">
      <button
        v-for="p in available"
        :key="p"
        type="button"
        class="px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors"
        :class="p === activePlatform
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:bg-hover-bg'"
        @click="selectPlatform(p)"
      >
        {{ platformLabel(p) }}
        <span v-if="states[p]?.linked" class="ml-1 text-success">●</span>
      </button>
    </div>

    <p class="text-xs text-text-tertiary mt-3 leading-relaxed">
      绑定后，你在网页端使用{{ platformLabel(activePlatform) }}时会按你自己的账号，其他人不受影响。
      登录凭据仅保存在服务器上，不会回传浏览器，也不会显示给任何人。
    </p>

    <p v-if="unavailableReason" class="text-xs text-warning mt-2 leading-relaxed">
      {{ unavailableReason }}
    </p>

    <div class="flex flex-wrap gap-2 mt-4">
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="qr.loading"
        :disabled="Boolean(unavailableReason)"
        @click="startQrLogin"
      >
        <Icon icon="mdi:qrcode" />
        {{ current.linked ? '重新扫码绑定' : '扫码绑定' }}
      </BaseButton>
      <BaseButton v-if="current.linked" variant="secondary" size="sm" @click="unlink">
        <Icon icon="mdi:link-off" />
        解除绑定
      </BaseButton>
    </div>

    <div v-if="qr.loading" class="flex items-center gap-2 mt-4 text-sm text-text-secondary">
      <Icon icon="mdi:loading" class="animate-spin" />
      生成二维码中…
    </div>
    <div v-else-if="qr.dataUrl" class="flex flex-col items-center gap-3 mt-4">
      <img
        :src="qr.dataUrl"
        class="w-[200px] h-[200px] rounded-[var(--radius-md)] border border-border-color"
        :alt="`${platformLabel(activePlatform)}登录二维码`"
      />
      <div class="flex items-center gap-1.5 text-[13px]" :class="qr.status === 'confirmed' ? 'text-success' : 'text-text-secondary'">
        <template v-if="qr.status === 'waiting'">
          <Icon icon="mdi:cellphone" /> 请使用{{ platformLabel(activePlatform) }}APP扫码
        </template>
        <template v-else-if="qr.status === 'scanned'">
          <Icon icon="mdi:check" /> 已扫码，请在手机上确认
        </template>
        <template v-else-if="qr.status === 'confirmed'">
          <Icon icon="mdi:check-circle" /> 绑定成功
        </template>
        <template v-else-if="qr.status === 'expired'">
          <Icon icon="mdi:refresh" /> 二维码已过期
          <button class="text-primary hover:underline" @click="startQrLogin">重新生成</button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import QRCode from 'qrcode';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { getProviderLabel } from '../../utils/platform';
import BaseButton from '../common/BaseButton.vue';

interface PlatformState {
  linked: boolean;
  loggedIn: boolean;
  nickname: string;
}

const toast = useToast();

/** Platforms whose provider exposes pollQrLogin — the ones a member can link. */
const CANDIDATES = ['netease', 'qq', 'kugou', 'bilibili'] as const;

const available = ref<string[]>([]);
const activePlatform = ref<string>('netease');
const states = reactive<Record<string, PlatformState>>({});
const unavailableReason = ref('');

const current = computed<PlatformState>(
  () => states[activePlatform.value] ?? { linked: false, loggedIn: false, nickname: '' },
);

function platformLabel(platform: string): string {
  return getProviderLabel(platform);
}

const qr = reactive({
  loading: false,
  dataUrl: '',
  key: '',
  status: 'waiting' as 'waiting' | 'scanned' | 'confirmed' | 'expired',
});
let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/** Ask each platform for its status; a 501 means "cannot self-login here". */
async function loadAvailability() {
  const usable: string[] = [];
  for (const platform of CANDIDATES) {
    try {
      const res = await http.get(`/api/me/music/${platform}/status`);
      states[platform] = {
        linked: Boolean(res.data?.linked),
        loggedIn: Boolean(res.data?.loggedIn),
        nickname: res.data?.nickname ?? '',
      };
      usable.push(platform);
    } catch (err: any) {
      // 501: this provider has no per-user login. Anything else is transient —
      // keep it out of the picker for now, the next mount retries.
      if (err?.response?.status !== 501) {
        states[platform] = { linked: false, loggedIn: false, nickname: '' };
      }
    }
  }
  available.value = usable;
  if (usable.length > 0 && !usable.includes(activePlatform.value)) {
    activePlatform.value = usable[0];
  }
}

async function refreshStatus() {
  const platform = activePlatform.value;
  unavailableReason.value = '';
  try {
    const res = await http.get(`/api/me/music/${platform}/status`);
    states[platform] = {
      linked: Boolean(res.data?.linked),
      loggedIn: Boolean(res.data?.loggedIn),
      nickname: res.data?.nickname ?? '',
    };
  } catch (err: any) {
    if (err?.response?.status === 501) {
      unavailableReason.value = `${platformLabel(platform)}暂不支持在网页端绑定账号`;
      return;
    }
    // 保留最近一次已知状态
  }
}

function selectPlatform(platform: string) {
  if (platform === activePlatform.value) return;
  stopPolling();
  qr.dataUrl = '';
  qr.key = '';
  activePlatform.value = platform;
  void refreshStatus();
}

async function startQrLogin() {
  const platform = activePlatform.value;
  stopPolling();
  qr.loading = true;
  qr.dataUrl = '';
  qr.status = 'waiting';
  try {
    const res = await http.post(`/api/me/music/${platform}/qrcode`);
    const { qrUrl, qrImg, key } = res.data;
    qr.key = key;
    // 深色码浅色底：不少 App 内置扫码器读不了反色码
    qr.dataUrl = qrImg || (await QRCode.toDataURL(qrUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }));
    pollTimer = setInterval(pollQrStatus, 2000);
  } catch {
    toast.error('二维码生成失败');
  } finally {
    qr.loading = false;
  }
}

async function pollQrStatus() {
  if (!qr.key) return;
  const platform = activePlatform.value;
  try {
    const res = await http.get(`/api/me/music/${platform}/qrcode/status`, {
      params: { key: qr.key },
    });
    qr.status = res.data.status;
    if (qr.status === 'confirmed') {
      stopPolling();
      toast.success(`已绑定${platformLabel(platform)}账号`);
      await refreshStatus();
    } else if (qr.status === 'expired') {
      // 停止轮询交给用户手动重生成：无人值守时不做无限自动重生成循环
      stopPolling();
    }
  } catch {
    // 轮询失败忽略，下个周期再试
  }
}

async function unlink() {
  const platform = activePlatform.value;
  const label = platformLabel(platform);
  if (!window.confirm(`确认解除${label}账号绑定？将回到机器人的共享账号。`)) return;
  try {
    await http.delete(`/api/me/music/${platform}`);
    stopPolling();
    qr.dataUrl = '';
    qr.key = '';
    toast.success('已解除绑定');
    await refreshStatus();
  } catch {
    toast.error('解除绑定失败');
  }
}

// Switching platform while a QR is on screen would leave a stale code up.
watch(activePlatform, () => {
  stopPolling();
  qr.dataUrl = '';
  qr.key = '';
});

onMounted(async () => {
  await loadAvailability();
  await refreshStatus();
});
onUnmounted(stopPolling);
</script>
