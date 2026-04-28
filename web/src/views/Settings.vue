<template>
  <div class="settings-page">
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>
    <h1 class="text-[28px] font-extrabold mb-8">设置</h1>

    <SettingsLayout :tabs="tabs" default-tab="general">
      <template #default="{ activeTab }">
        <SettingsTheme v-if="activeTab === 'general'" />

        <SettingsGeneral
          v-if="activeTab === 'general'"
          class="mt-6"
          :current-quality="currentQuality"
          :command-prefix="commandPrefix"
          :idle-timeout="idleTimeout"
          @set-quality="setQuality"
          @save-prefix="savePrefix"
          @save-idle-timeout="saveIdleTimeout"
        />

        <SettingsBots
          v-if="activeTab === 'bots'"
          :bots="store.bots"
          @toggle-bot="toggleBot"
          @edit-bot="openEditBot"
          @delete-bot="deleteBot"
          @create-bot="createBot"
        />

        <SettingsPlatforms
          v-if="activeTab === 'platforms'"
          :auth-states="{ netease: neteaseAuth, qq: qqAuth, bilibili: bilibiliAuth }"
          :qr-states="{ netease: neteaseQr, qq: qqQr, bilibili: bilibiliQr }"
          @start-qr="startQrLogin"
          @save-cookie="saveCookie"
        />
      </template>
    </SettingsLayout>

    <!-- Edit Bot Modal -->
    <BaseModal v-model="editModalOpen" title="编辑机器人">
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">名称</label>
          <input v-model="editForm.name" class="input" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器地址</label>
          <input v-model="editForm.serverAddress" class="input" placeholder="ts.example.com" />
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-1">
            <label class="block text-xs font-semibold opacity-70 mb-1">端口</label>
            <input v-model.number="editForm.serverPort" type="number" class="input" />
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold opacity-70 mb-1">昵称</label>
            <input v-model="editForm.nickname" class="input" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">默认频道（可选）</label>
          <input v-model="editForm.defaultChannel" class="input" placeholder="音乐频道" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">频道密码（可选）</label>
          <input v-model="editForm.channelPassword" type="password" class="input" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器密码（可选）</label>
          <input v-model="editForm.serverPassword" type="password" class="input" />
        </div>
      </div>
      <template #footer="{ close }">
        <BaseButton variant="secondary" @click="close">取消</BaseButton>
        <BaseButton @click="saveEditBot">保存</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type BotStatus } from '../stores/player';
import { useToast } from '../composables/useToast';
import SettingsLayout from '../components/settings/SettingsLayout.vue';
import SettingsTheme from '../components/settings/SettingsTheme.vue';
import SettingsGeneral from '../components/settings/SettingsGeneral.vue';
import SettingsBots from '../components/settings/SettingsBots.vue';
import SettingsPlatforms from '../components/settings/SettingsPlatforms.vue';
import BaseModal from '../components/common/BaseModal.vue';
import BaseButton from '../components/common/BaseButton.vue';

const store = usePlayerStore();
const toast = useToast();

const tabs = [
  { key: 'general', label: '通用设置', icon: 'mdi:cog' },
  { key: 'bots', label: '机器人管理', icon: 'mdi:robot' },
  { key: 'platforms', label: '音乐账号', icon: 'mdi:music-box' },
];

// ── General settings state ──
const currentQuality = ref('exhigh');
const commandPrefix = ref('!');
const idleTimeout = ref(0);

// ── Bot edit modal ──
const editModalOpen = ref(false);
const editForm = reactive({
  name: '', serverAddress: '', serverPort: 9987, nickname: '',
  defaultChannel: '', channelPassword: '', serverPassword: '',
});
let editingBotId: string | null = null;

// ── Platform auth state ──
const neteaseAuth = reactive({ loggedIn: false, nickname: '' });
const qqAuth = reactive({ loggedIn: false, nickname: '' });
const bilibiliAuth = reactive({ loggedIn: false, nickname: '' });

interface QrState {
  loading: boolean;
  dataUrl: string;
  key: string;
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired';
  pollTimer: ReturnType<typeof setInterval> | null;
}

const neteaseQr = reactive<QrState>({ loading: false, dataUrl: '', key: '', status: 'waiting', pollTimer: null });
const qqQr = reactive<QrState>({ loading: false, dataUrl: '', key: '', status: 'waiting', pollTimer: null });
const bilibiliQr = reactive<QrState>({ loading: false, dataUrl: '', key: '', status: 'waiting', pollTimer: null });

function getQrState(platform: string): QrState {
  if (platform === 'bilibili') return bilibiliQr;
  return platform === 'netease' ? neteaseQr : qqQr;
}

// ── General handlers ──
async function loadQuality() {
  try {
    const res = await http.get('/api/music/quality');
    currentQuality.value = res.data.netease || 'exhigh';
  } catch { /* ignore */ }
}

async function setQuality(q: string) {
  currentQuality.value = q;
  try {
    await http.post('/api/music/quality', { quality: q });
    toast.success('音质设置已保存');
  } catch {
    toast.error('保存音质设置失败');
  }
}

async function savePrefix() {
  toast.info('命令前缀设置客户端存储');
}

async function loadIdleTimeout() {
  try {
    const res = await http.get('/api/bot/settings');
    idleTimeout.value = res.data.idleTimeoutMinutes ?? 0;
  } catch { /* ignore */ }
}

async function saveIdleTimeout(minutes: number) {
  try {
    await http.post('/api/bot/settings', { idleTimeoutMinutes: minutes });
    toast.success('闲置超时设置已保存');
  } catch {
    toast.error('保存闲置超时设置失败');
  }
}

// ── Bot handlers ──
async function toggleBot(botId: string, connected: boolean) {
  try {
    await http.post(`/api/bot/${botId}/${connected ? 'stop' : 'start'}`);
    await store.fetchBots();
  } catch {
    toast.error('操作失败');
  }
}

async function openEditBot(bot: BotStatus) {
  editingBotId = bot.id;
  editForm.name = bot.name;
  try {
    const res = await http.get(`/api/bot/${bot.id}/config`);
    editForm.serverAddress = res.data.serverAddress ?? '';
    editForm.serverPort = res.data.serverPort ?? 9987;
    editForm.nickname = res.data.nickname ?? '';
    editForm.defaultChannel = res.data.defaultChannel ?? '';
    editForm.channelPassword = res.data.channelPassword ?? '';
    editForm.serverPassword = res.data.serverPassword ?? '';
  } catch {
    editForm.serverAddress = '';
    editForm.serverPort = 9987;
    editForm.nickname = bot.name;
    editForm.defaultChannel = '';
    editForm.channelPassword = '';
    editForm.serverPassword = '';
  }
  editModalOpen.value = true;
}

async function saveEditBot() {
  if (!editingBotId) return;
  try {
    await http.put(`/api/bot/${editingBotId}`, editForm);
    editModalOpen.value = false;
    editingBotId = null;
    await store.fetchBots();
    toast.success('机器人配置已保存');
  } catch {
    toast.error('保存失败');
  }
}

async function deleteBot(botId: string, botName: string) {
  if (!confirm(`确认删除机器人 "${botName}"？此操作不可撤销。`)) return;
  try {
    await http.delete(`/api/bot/${botId}`);
    if (store.activeBotId === botId) store.activeBotId = null;
    store.removeBotStatus(botId);
    await store.fetchBots();
    toast.success('机器人已删除');
  } catch {
    toast.error('删除失败');
  }
}

async function createBot(form: { name: string; serverAddress: string; serverPort: number; nickname: string; defaultChannel: string; serverPassword: string }) {
  if (!form.name || !form.serverAddress) return;
  try {
    await http.post('/api/bot', {
      name: form.name,
      serverAddress: form.serverAddress,
      serverPort: form.serverPort || 9987,
      nickname: form.nickname || form.name,
      defaultChannel: form.defaultChannel || undefined,
      serverPassword: form.serverPassword || undefined,
      autoStart: false,
    });
    await store.fetchBots();
    toast.success('机器人已创建');
  } catch {
    toast.error('创建失败');
  }
}

// ── Platform handlers ──
async function checkAuthStatus() {
  try {
    const [nRes, qRes, bRes] = await Promise.all([
      http.get('/api/auth/status', { params: { platform: 'netease' } }),
      http.get('/api/auth/status', { params: { platform: 'qq' } }),
      http.get('/api/auth/status', { params: { platform: 'bilibili' } }),
    ]);
    Object.assign(neteaseAuth, nRes.data);
    Object.assign(qqAuth, qRes.data);
    Object.assign(bilibiliAuth, bRes.data);
  } catch { /* ignore */ }
}

async function startQrLogin(platform: string) {
  const qr = getQrState(platform);
  if (qr.pollTimer) clearInterval(qr.pollTimer);
  qr.loading = true;
  qr.dataUrl = '';
  qr.status = 'waiting';

  try {
    const res = await http.post('/api/auth/qrcode', { platform });
    qr.key = res.data.key;
    qr.dataUrl = res.data.qrImg || '';
    qr.loading = false;
    qr.pollTimer = setInterval(() => pollQrStatus(platform), 2000);
  } catch {
    qr.loading = false;
    toast.error('二维码生成失败');
  }
}

async function pollQrStatus(platform: string) {
  const qr = getQrState(platform);
  if (!qr.key) return;
  try {
    const res = await http.get('/api/auth/qrcode/status', { params: { key: qr.key, platform } });
    qr.status = res.data.status;
    if (qr.status === 'confirmed') {
      if (qr.pollTimer) clearInterval(qr.pollTimer);
      qr.pollTimer = null;
      await checkAuthStatus();
    } else if (qr.status === 'expired') {
      if (qr.pollTimer) clearInterval(qr.pollTimer);
      qr.pollTimer = null;
    }
  } catch { /* ignore */ }
}

async function saveCookie(platform: string, cookie: string) {
  if (!cookie) return;
  try {
    await http.post('/api/auth/cookie', { platform, cookie });
    await checkAuthStatus();
    toast.success('Cookie 已保存');
  } catch {
    toast.error('保存 Cookie 失败');
  }
}

onMounted(() => {
  store.fetchBots();
  checkAuthStatus();
  loadQuality();
  loadIdleTimeout();
});

onUnmounted(() => {
  [neteaseQr, qqQr, bilibiliQr].forEach((qr) => {
    if (qr.pollTimer) clearInterval(qr.pollTimer);
  });
});
</script>

<style scoped>
.input {
  width: 100%;
  padding: 10px 14px;
  background: var(--hover-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.input:focus { border-color: var(--color-primary); }
</style>
