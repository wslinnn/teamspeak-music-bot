<template>
  <div class="space-y-6">
    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:music-box-multiple" class="text-lg opacity-60" />
        在线音源
      </div>
      <div class="space-y-0.5" v-if="loaded">
        <BaseToggle
          v-for="p in GATEABLE_PROVIDERS"
          :key="p"
          :model-value="form.enabledProviders.includes(p)"
          :label="getProviderLabel(p)"
          @update:model-value="toggleProvider(p, $event)"
        />
        <p class="text-xs text-text-tertiary mt-2">
          网易云/QQ 的内嵌服务随启动初始化，切换这两项后需重启生效；其余即时生效。
          本地与 Spotify 分别由「行为设置」和下方连接卡片控制。
        </p>
      </div>
      <SkeletonLoader v-else v-for="n in 3" :key="n" height="48px" class="mb-2" />
    </div>

    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:playlist-star" class="text-lg opacity-60" />
        默认音源
      </div>
      <div v-if="loaded" class="flex items-center gap-3">
        <select v-model="form.defaultPlatform" class="input flex-1">
          <option :value="null">自动（按优先级）</option>
          <option v-for="p in defaultableProviders" :key="p" :value="p">
            {{ getProviderLabel(p) }}
          </option>
        </select>
      </div>
      <p class="text-xs text-text-tertiary mt-1">
        点歌命令与 WebUI 未指定平台时使用的音源；被禁用后自动回退。
      </p>
    </div>

    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:jellyfish" class="text-lg opacity-60" />
        Jellyfin 音乐库
      </div>
      <div v-if="loaded" class="space-y-3">
        <input v-model="form.jellyfin.serverUrl" class="input" placeholder="服务器地址，如 https://jellyfin.example.com" />
        <select v-model="form.jellyfin.authMode" class="input">
          <option value="userpass">用户名 / 密码</option>
          <option value="apikey">API Key（管理员）</option>
        </select>
        <template v-if="form.jellyfin.authMode === 'userpass'">
          <input v-model="form.jellyfin.username" class="input" placeholder="用户名" />
          <input
            v-model="form.jellyfin.password"
            type="password"
            class="input"
            :placeholder="jfHasPassword ? '已配置（留空保持不变）' : '密码'"
          />
        </template>
        <template v-else>
          <input
            v-model="form.jellyfin.apiKey"
            type="password"
            class="input"
            :placeholder="jfHasApiKey ? '已配置（留空保持不变）' : '管理员 API Key'"
          />
          <input v-model="form.jellyfin.userId" class="input" placeholder="用户 ID（曲库/收藏归属）" />
        </template>
        <div class="flex items-center gap-3">
          <BaseButton variant="secondary" :loading="jfTesting" :disabled="jfTesting" @click="testJellyfin">
            测试连接
          </BaseButton>
          <span v-if="jfTestResult" class="text-xs" :class="jfTestResult.ok ? 'text-green-600' : 'text-red-500'">
            {{ jfTestResult.ok
              ? `已连接：${jfTestResult.serverName ?? ''} (${jfTestResult.version ?? '版本未知'})`
              : jfTestResult.error || '连接失败' }}
          </span>
        </div>
      </div>
      <SkeletonLoader v-else height="120px" />
    </div>

    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:spotify" class="text-lg opacity-60" />
        Spotify 连接
      </div>
      <div v-if="loaded" class="space-y-3">
        <input v-model="form.spotify.clientId" class="input" placeholder="Client ID" />
        <input
          v-model="form.spotify.clientSecret"
          type="password"
          class="input"
          :placeholder="spHasSecret ? '已配置（留空保持不变）' : 'Client Secret'"
        />
        <input v-model="form.spotify.deviceName" class="input" placeholder="设备名（Connect 显示用）" />
        <div class="grid grid-cols-2 gap-3">
          <select v-model.number="form.spotify.bitrate" class="input">
            <option :value="96">96 kbps</option>
            <option :value="160">160 kbps</option>
            <option :value="320">320 kbps</option>
          </select>
          <select v-model="form.spotify.backend" class="input">
            <option value="auto">后端：自动</option>
            <option value="go-librespot">go-librespot</option>
            <option value="librespot">librespot</option>
          </select>
        </div>
        <p class="text-xs text-text-tertiary">
          保存后到「音乐账号」页完成 OAuth 授权（需服务器公网可达）。
        </p>
      </div>
      <SkeletonLoader v-else height="160px" />
    </div>

    <BaseButton :loading="saving" :disabled="!loaded" @click="save">保存</BaseButton>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { getProviderLabel } from '../../utils/platform';
import BaseToggle from '../common/BaseToggle.vue';
import BaseButton from '../common/BaseButton.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';

// 可由 enabledProviders 直接管控的在线音源（local/spotify 走各自专属开关）
const GATEABLE_PROVIDERS = ['netease', 'qq', 'bilibili', 'youtube', 'kugou', 'jellyfin'] as const;

const toast = useToast();
const loaded = ref(false);
const saving = ref(false);
const jfTesting = ref(false);
const jfTestResult = ref<{ ok: boolean; serverName?: string; version?: string; error?: string } | null>(null);
const jfHasPassword = ref(false);
const jfHasApiKey = ref(false);
const spHasSecret = ref(false);

const form = reactive({
  enabledProviders: [] as string[],
  defaultPlatform: null as string | null,
  jellyfin: {
    serverUrl: '',
    authMode: 'userpass' as 'userpass' | 'apikey',
    username: '',
    password: '',
    apiKey: '',
    userId: '',
  },
  spotify: {
    clientId: '',
    clientSecret: '',
    deviceName: '',
    bitrate: 320,
    backend: 'auto' as 'auto' | 'go-librespot' | 'librespot',
  },
});

const defaultableProviders = computed(() =>
  GATEABLE_PROVIDERS.filter((p) => form.enabledProviders.includes(p)),
);

function toggleProvider(p: string, on: boolean | string | number) {
  const set = new Set(form.enabledProviders);
  if (on === true) set.add(p);
  else set.delete(p);
  form.enabledProviders = [...set];
  // 默认音源被禁用时回退"自动"
  if (form.defaultPlatform && !set.has(form.defaultPlatform)) form.defaultPlatform = null;
}

onMounted(async () => {
  try {
    const res = await http.get('/api/bot/settings');
    form.enabledProviders = res.data.enabledProviders ?? [];
    form.defaultPlatform = res.data.defaultPlatform ?? null;
    Object.assign(form.jellyfin, {
      serverUrl: res.data.jellyfin?.serverUrl ?? '',
      authMode: res.data.jellyfin?.authMode === 'apikey' ? 'apikey' : 'userpass',
      username: res.data.jellyfin?.username ?? '',
      userId: res.data.jellyfin?.userId ?? '',
    });
    jfHasPassword.value = res.data.jellyfin?.hasPassword === true;
    jfHasApiKey.value = res.data.jellyfin?.hasApiKey === true;
    Object.assign(form.spotify, {
      clientId: res.data.spotify?.clientId ?? '',
      deviceName: res.data.spotify?.deviceName ?? '',
      bitrate: res.data.spotify?.bitrate ?? 320,
      backend: res.data.spotify?.backend ?? 'auto',
    });
    spHasSecret.value = res.data.spotify?.hasClientSecret === true;
    loaded.value = true;
  } catch {
    toast.error('读取音源设置失败');
  }
});

async function testJellyfin() {
  jfTesting.value = true;
  jfTestResult.value = null;
  try {
    // 空字段服务端自动回退已存配置，可直接测试已保存的连接
    const res = await http.post('/api/auth/jellyfin/test', { ...form.jellyfin });
    jfTestResult.value = res.data;
  } catch (err: any) {
    jfTestResult.value = { ok: false, error: err?.response?.data?.error || '连接失败' };
  } finally {
    jfTesting.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await http.post('/api/bot/settings', {
      enabledProviders: form.enabledProviders,
      defaultPlatform: form.defaultPlatform,
      jellyfin: { ...form.jellyfin },
      spotify: { ...form.spotify },
    });
    toast.success('音源设置已保存');
  } catch {
    toast.error('保存音源设置失败（需要管理员权限）');
  } finally {
    saving.value = false;
  }
}
</script>
