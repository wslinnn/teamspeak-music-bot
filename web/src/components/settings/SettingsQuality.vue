<template>
  <div>
    <div class="flex items-center gap-2 mb-3 text-sm font-medium">
      <Icon icon="mdi:music-note-eighth" class="text-lg opacity-60" />
      音质
    </div>
    <div class="space-y-4">
      <!-- 默认音源（netease 六档） -->
      <div v-if="canQuality">
        <div class="text-xs text-foreground-subtle mb-2">默认音源质量</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button
            v-for="q in qualityLevels"
            :key="q.value"
            class="rounded-lg border-2 p-3 text-center transition-all"
            :class="neteaseQuality === q.value
              ? 'border-primary bg-primary/10'
              : 'border-transparent bg-interactive-hover hover:border-border-default'"
            @click="setNeteaseQuality(q.value)"
          >
            <div class="text-sm font-semibold">{{ q.label }}</div>
            <div class="text-xs text-foreground-subtle mt-0.5">{{ q.desc }}</div>
          </button>
        </div>
      </div>

      <!-- Jellyfin（服务器转码档） -->
      <div v-if="canQuality && jellyfinEnabled">
        <div class="text-xs text-foreground-subtle mb-2">Jellyfin 音质</div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            v-for="q in jellyfinQualityLevels"
            :key="q.value"
            class="rounded-lg border-2 p-3 text-center transition-all"
            :class="jellyfinQuality === q.value
              ? 'border-primary bg-primary/10'
              : 'border-transparent bg-interactive-hover hover:border-border-default'"
            @click="setJellyfinQuality(q.value)"
          >
            <div class="text-sm font-semibold">{{ q.label }}</div>
            <div class="text-xs text-foreground-subtle mt-0.5">{{ q.desc }}</div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const toast = useToast();
const canQuality = computed(() => auth.can('quality'));

const qualityLevels = [
  { value: 'standard', label: '标准', desc: '128kbps MP3' },
  { value: 'higher', label: '较高', desc: '192kbps MP3' },
  { value: 'exhigh', label: '极高', desc: '320kbps MP3' },
  { value: 'lossless', label: '无损', desc: 'FLAC' },
  { value: 'hires', label: 'Hi-Res', desc: '高解析度' },
  { value: 'jymaster', label: '超清母带', desc: '最高质量' },
];

// ── 默认音源质量 ──
const neteaseQuality = ref('exhigh');

// ── Jellyfin 音质档（direct=原始直传，其余为服务器转码）──
const jellyfinEnabled = ref(false);
const jellyfinQuality = ref('direct');
const jellyfinQualityLevels = [
  { value: 'direct', label: '原始直传', desc: 'Direct（无转码）' },
  { value: '320', label: '320kbps', desc: '服务器转码' },
  { value: '192', label: '192kbps', desc: '服务器转码' },
  { value: '128', label: '128kbps', desc: '服务器转码' },
];

onMounted(async () => {
  try {
    const [providersRes, qualityRes] = await Promise.all([
      http.get('/api/music/providers'),
      http.get('/api/music/quality'),
    ]);
    jellyfinEnabled.value = (providersRes.data.enabled ?? []).includes('jellyfin');
    neteaseQuality.value = qualityRes.data.netease || 'exhigh';
    jellyfinQuality.value = qualityRes.data.jellyfin || 'direct';
  } catch {
    // 拉不到就不展示 Jellyfin 区块，默认音源保持默认值
  }
});

async function setNeteaseQuality(q: string) {
  neteaseQuality.value = q;
  try {
    await http.post('/api/music/quality', { quality: q });
  } catch {
    toast.error('保存音质设置失败');
  }
}

async function setJellyfinQuality(q: string) {
  jellyfinQuality.value = q;
  try {
    await http.post('/api/music/quality', { quality: q, platform: 'jellyfin' });
  } catch {
    // 错误信息由 http 拦截器统一 toast
  }
}
</script>
