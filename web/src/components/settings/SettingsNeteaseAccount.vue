<template>
  <!-- 当前登录用户自己的网易云账号：私人 FM 按该账号推荐（#164）。
       设置页整页 blockGuest，本区块天然只对成员/管理员可见。 -->
  <div class="rounded-[var(--radius-lg)] bg-surface-card p-5">
    <div class="flex items-center gap-3">
      <Icon icon="mdi:radio" class="text-2xl text-primary shrink-0" />
      <div class="min-w-0">
        <div class="text-sm font-semibold">我的网易云账号（私人FM）</div>
        <div class="text-xs mt-0.5" :class="status.loggedIn ? 'text-success' : 'text-text-tertiary'">
          <template v-if="status.loggedIn">已绑定：{{ status.nickname || '网易云账号' }}</template>
          <template v-else-if="status.linked">已绑定，但登录已失效，请重新扫码</template>
          <template v-else>未绑定 — 私人FM使用机器人的共享账号</template>
        </div>
      </div>
    </div>

    <p class="text-xs text-text-tertiary mt-3 leading-relaxed">
      绑定后，你在网页端开启的网易云私人FM会按你自己的口味推荐，其他人不受影响。
      登录凭据仅保存在服务器上，不会回传浏览器，也不会显示给任何人。
    </p>

    <div class="flex flex-wrap gap-2 mt-4">
      <BaseButton variant="secondary" size="sm" :loading="qr.loading" @click="startQrLogin">
        <Icon icon="mdi:qrcode" />
        {{ status.linked ? '重新扫码绑定' : '扫码绑定' }}
      </BaseButton>
      <BaseButton v-if="status.linked" variant="secondary" size="sm" @click="unlink">
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
        alt="网易云登录二维码"
      />
      <div class="flex items-center gap-1.5 text-[13px]" :class="qr.status === 'confirmed' ? 'text-success' : 'text-text-secondary'">
        <template v-if="qr.status === 'waiting'">
          <Icon icon="mdi:cellphone" /> 请使用网易云音乐APP扫码
        </template>
        <template v-else-if="qr.status === 'scanned'">
          <Icon icon="mdi:check" /> 已扫码，请在手机上确认
        </template>
        <template v-else-if="qr.status === 'confirmed'">
          <Icon icon="mdi:check-circle" /> 绑定成功，私人FM将按你的账号推荐
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
import { onMounted, onUnmounted, reactive } from 'vue';
import { Icon } from '@iconify/vue';
import QRCode from 'qrcode';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import BaseButton from '../common/BaseButton.vue';

const BASE = '/api/me/music/netease';

const toast = useToast();

const status = reactive({ linked: false, loggedIn: false, nickname: '' });
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

async function refreshStatus() {
  try {
    const res = await http.get(`${BASE}/status`);
    status.linked = Boolean(res.data?.linked);
    status.loggedIn = Boolean(res.data?.loggedIn);
    status.nickname = res.data?.nickname ?? '';
  } catch {
    // 保留最近一次已知状态
  }
}

async function startQrLogin() {
  stopPolling();
  qr.loading = true;
  qr.dataUrl = '';
  qr.status = 'waiting';
  try {
    const res = await http.post(`${BASE}/qrcode`);
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
  try {
    const res = await http.get(`${BASE}/qrcode/status`, { params: { key: qr.key } });
    qr.status = res.data.status;
    if (qr.status === 'confirmed') {
      stopPolling();
      toast.success('已绑定，私人FM将按你的账号推荐');
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
  if (!window.confirm('确认解除网易云账号绑定？私人FM将回到机器人的共享账号。')) return;
  try {
    await http.delete(BASE);
    stopPolling();
    qr.dataUrl = '';
    qr.key = '';
    toast.success('已解除绑定');
    await refreshStatus();
  } catch {
    toast.error('解除绑定失败');
  }
}

onMounted(refreshStatus);
onUnmounted(stopPolling);
</script>
