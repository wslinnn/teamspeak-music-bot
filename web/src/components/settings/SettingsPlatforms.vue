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
          @click="loginModes[platform.key] = 'qr'; $emit('startQr', platform.key)"
        >
          <Icon icon="mdi:qrcode" class="mr-1" /> 扫码登录
        </BaseButton>
        <BaseButton
          size="sm"
          :variant="loginModes[platform.key] === 'cookie' ? 'primary' : 'secondary'"
          @click="loginModes[platform.key] = 'cookie'; $emit('stopQr', platform.key)"
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

    <!-- Spotify OAuth（配置入口在「音源」页的连接卡片） -->
    <div class="rounded-xl bg-interactive-hover p-5">
      <div class="flex items-center gap-3 mb-4">
        <Icon icon="mdi:spotify" class="text-[28px] text-[#1DB954]" />
        <div>
          <div class="text-[15px] font-semibold">Spotify</div>
          <div class="text-xs" :class="spotifyStatusView.tone === 'ok' ? 'text-success' : 'text-foreground-subtle'">
            {{ spotifyStatusView.label }}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton size="sm" :loading="connecting" :disabled="spotifyStatusView.tone === 'off'" @click="connectSpotify">
          <Icon icon="mdi:open-in-new" class="mr-1" /> 连接 Spotify
        </BaseButton>
        <BaseButton size="sm" variant="secondary" :disabled="spotifyLoading" @click="loadSpotifyStatus">刷新</BaseButton>
      </div>
      <p class="text-xs text-text-tertiary mt-3">
        走 OAuth 网页授权；回调地址由服务器公网地址（public-url）决定，需公网可达才能完成授权。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
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
  (e: 'stopQr', platform: string): void;
  (e: 'saveCookie', platform: string, cookie: string): void;
}>();

const platforms = [
  { key: 'netease', name: '网易云音乐', icon: 'mdi:cloud-outline', iconClass: 'text-primary' },
  { key: 'qq', name: 'QQ音乐', icon: 'mdi:music-circle-outline', iconClass: 'text-primary' },
  { key: 'bilibili', name: '哔哩哔哩', icon: 'mdi:video-outline', iconClass: 'text-[#00a1d6]' },
  { key: 'kugou', name: '酷狗音乐', icon: 'mdi:music-note-outline', iconClass: 'text-[#00A9FF]' },
];

const loginModes = reactive<Record<string, 'qr' | 'cookie'>>({});
const cookieInputs = reactive<Record<string, string>>({ netease: '', qq: '', bilibili: '', kugou: '' });

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

// ── Spotify OAuth（D6）：状态展示 + 跳转授权 ──
interface SpotifyStatus {
  authorized: boolean;
  backend: string;
  deviceName: string;
  binaryAvailable: boolean;
}

const toast = useToast();
const spotifyStatus = ref<SpotifyStatus | null>(null);
const spotifyUnavailable = ref(false);
const spotifyLoading = ref(false);
const connecting = ref(false);

const spotifyStatusView = computed(() => {
  if (spotifyUnavailable.value) return { label: '未配置（先到「音源」页填写 Spotify 连接信息）', tone: 'off' as const };
  if (!spotifyStatus.value) return { label: '未知', tone: 'warn' as const };
  if (!spotifyStatus.value.binaryAvailable) return { label: '未检测到 librespot 可执行文件', tone: 'warn' as const };
  if (!spotifyStatus.value.authorized) return { label: '未授权（点击"连接 Spotify"登录）', tone: 'warn' as const };
  return { label: `已就绪 · 后端 ${spotifyStatus.value.backend}`, tone: 'ok' as const };
});

async function loadSpotifyStatus() {
  spotifyLoading.value = true;
  try {
    const res = await http.get('/api/spotify/status');
    spotifyStatus.value = res.data;
    spotifyUnavailable.value = false;
  } catch (err: any) {
    // 404 = 服务端未启用 Spotify（未配置 clientId 时路由不挂载）
    spotifyUnavailable.value = err?.response?.status === 404;
    spotifyStatus.value = null;
  } finally {
    spotifyLoading.value = false;
  }
}

async function connectSpotify() {
  connecting.value = true;
  try {
    const res = await http.get('/api/spotify/login');
    const url = res.data.url as string | undefined;
    // 纵深防御（审计 S1）：只跟随 accounts.spotify.com 的授权跳转，
    // 后端异常/被劫持时不得把管理员导航到任意域。
    if (url) {
      try {
        if (new URL(url).hostname === 'accounts.spotify.com') {
          window.location.href = url;
          return;
        }
      } catch {
        // fall through to the error below
      }
    }
    toast.error('获取授权链接失败');
  } catch {
    // 错误信息由 http 拦截器统一 toast
  } finally {
    connecting.value = false;
  }
}

onMounted(loadSpotifyStatus);
</script>
