<template>
  <div class="space-y-5">
    <div
      v-for="platform in platforms"
      :key="platform.key"
      class="rounded-xl bg-interactive-hover p-5"
    >
      <div class="flex items-center gap-3 mb-4">
        <Icon :icon="platform.icon" class="text-[28px]" :class="platform.iconClass" />
        <div>
          <div class="text-[15px] font-semibold">{{ platform.name }}</div>
          <div class="text-xs" :class="authStates[platform.key].loggedIn ? 'text-success' : 'text-foreground-subtle'">
            {{ authStates[platform.key].loggedIn ? `已登录: ${authStates[platform.key].nickname}` : '未登录' }}
          </div>
        </div>
      </div>

      <div class="flex gap-2 mb-4">
        <BaseButton
          size="sm"
          :variant="loginModes[platform.key] === 'qr' ? 'primary' : 'secondary'"
          @click="$emit('startQr', platform.key)"
        >
          <Icon icon="mdi:qrcode" class="mr-1" /> 扫码登录
        </BaseButton>
        <BaseButton
          size="sm"
          :variant="loginModes[platform.key] === 'cookie' ? 'primary' : 'secondary'"
          @click="loginModes[platform.key] = 'cookie'"
        >
          <Icon icon="mdi:cookie" class="mr-1" /> Cookie登录
        </BaseButton>
      </div>

      <!-- QR -->
      <div v-if="loginModes[platform.key] === 'qr'" class="flex flex-col items-center py-5">
        <div v-if="qrStates[platform.key].loading" class="flex items-center gap-2 text-sm text-foreground-muted">
          <LoadingSpinner size="sm" /> 生成二维码中...
        </div>
        <div v-else-if="qrStates[platform.key].dataUrl" class="flex flex-col items-center gap-4">
          <img :src="qrStates[platform.key].dataUrl" class="w-[200px] h-[200px] rounded-[var(--radius-md)] border-2 border-border-default" :alt="`扫码登录 ${platform.name}`" />
          <div class="flex items-center gap-1.5 rounded-md bg-surface-card px-4 py-2 text-sm" :class="qrStatusClass(qrStates[platform.key].status)">
            <Icon :icon="qrStatusIcon(qrStates[platform.key].status)" />
            <span>{{ qrStatusText(platform.key, qrStates[platform.key].status) }}</span>
          </div>
        </div>
      </div>

      <!-- Cookie -->
      <div v-if="loginModes[platform.key] === 'cookie'" class="flex flex-col gap-2">
        <textarea
          v-model="cookieInputs[platform.key]"
          rows="3"
          class="w-full rounded-md border border-border-default bg-surface-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary resize-y"
          :placeholder="`粘贴${platform.name}Cookie...`"
        />
        <BaseButton size="sm" class="self-end" @click="$emit('saveCookie', platform.key, cookieInputs[platform.key])">
          保存Cookie
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { Icon } from '@iconify/vue';
import BaseButton from '../common/BaseButton.vue';
import LoadingSpinner from '../common/LoadingSpinner.vue';

interface QrState {
  loading: boolean;
  dataUrl: string;
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired';
}

interface AuthState {
  loggedIn: boolean;
  nickname: string;
}

const props = defineProps<{
  authStates: Record<string, AuthState>;
  qrStates: Record<string, QrState>;
}>();

const emit = defineEmits<{
  (e: 'startQr', platform: string): void;
  (e: 'saveCookie', platform: string, cookie: string): void;
}>();

const platforms = [
  { key: 'netease', name: '网易云音乐', icon: 'mdi:cloud-outline', iconClass: 'text-primary' },
  { key: 'qq', name: 'QQ音乐', icon: 'mdi:music-circle-outline', iconClass: 'text-primary' },
  { key: 'bilibili', name: '哔哩哔哩', icon: 'mdi:video-outline', iconClass: 'text-[#00a1d6]' },
];

const loginModes = reactive<Record<string, 'qr' | 'cookie'>>({});
const cookieInputs = reactive<Record<string, string>>({ netease: '', qq: '', bilibili: '' });

function qrStatusClass(status: QrState['status']) {
  switch (status) {
    case 'scanned': return 'text-warning bg-warning/10';
    case 'confirmed': return 'text-success bg-success/10';
    case 'expired': return 'text-danger bg-danger/10';
    default: return 'text-foreground-muted bg-surface-card';
  }
}

function qrStatusIcon(status: QrState['status']) {
  switch (status) {
    case 'scanned': return 'mdi:check';
    case 'confirmed': return 'mdi:check-circle';
    case 'expired': return 'mdi:refresh';
    default: return 'mdi:cellphone';
  }
}

function qrStatusText(platform: string, status: QrState['status']) {
  const name = platforms.find(p => p.key === platform)?.name ?? '';
  switch (status) {
    case 'scanned': return '已扫码，请在手机上确认';
    case 'confirmed': return '登录成功!';
    case 'expired': return '二维码已过期';
    default: return `请使用${name}APP扫码`;
  }
}
</script>
