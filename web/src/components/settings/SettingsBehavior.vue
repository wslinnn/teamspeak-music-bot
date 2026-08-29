<template>
  <div class="space-y-6">
    <div>
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:tune" class="text-lg opacity-60" />
        播放行为
      </div>
      <p class="text-xs text-foreground-subtle mb-3">开关即时生效并自动保存</p>
      <div class="space-y-0.5" v-if="loaded">
        <BaseToggle
          v-model="form.autoPauseOnEmpty"
          label="频道无人时自动暂停"
          hint="机器人所在频道没有其他人时自动暂停，有人回到频道后自动恢复播放（手动暂停不受影响）"
        />
        <BaseToggle
          v-model="form.savedQueuesEnabled"
          label="保存/加载播放清单"
          hint="开启后可在播放队列抽屉中保存/加载清单，机器人重启后自动恢复上次的队列"
        />
        <BaseToggle
          v-model="form.playKeepsQueue"
          label="单曲直接播放不清空队列"
          hint="直接播放一首歌时插入到当前歌曲之后，播完继续原队列，而不是清空整个队列"
        />
      </div>
      <SkeletonLoader v-else v-for="n in 3" :key="n" height="48px" class="mb-2" />
    </div>

    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:file-music" class="text-lg opacity-60" />
        本地媒体
      </div>
      <div class="space-y-0.5" v-if="loaded">
        <BaseToggle
          v-model="form.localAudioEnabled"
          label="本地音视频上传播放"
          hint="允许在搜索页上传本地音频/视频文件播放（视频仅保留音轨）"
        />
      </div>
      <SkeletonLoader v-else height="48px" />
    </div>

    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:account-voice" class="text-lg opacity-60" />
        语音闪避
      </div>
      <div class="space-y-0.5" v-if="loaded">
        <BaseToggle
          v-model="form.voiceDuckingEnabled"
          label="有人说话时自动压低音乐"
          hint="检测到频道内其他人说话时平滑降低音量，停止说话后平滑恢复"
        />
        <div class="flex items-center gap-2 py-2 pl-1">
          <span class="text-sm text-foreground-muted">说话时保留音量</span>
          <input
            v-model.number="form.voiceDuckingVolume"
            type="number"
            min="0"
            max="100"
            aria-label="说话时保留音量百分比"
            class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
          <span class="text-sm text-foreground-muted">%</span>
        </div>
      </div>
      <SkeletonLoader v-else height="48px" />
    </div>

    <div>
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:console" class="text-lg opacity-60" />
        命令前缀
      </div>
      <p class="text-xs text-foreground-subtle mb-3">TeamSpeak 聊天命令的前缀，失焦或回车即保存</p>
      <div v-if="loaded" class="flex items-center gap-2">
        <input
          v-model="localPrefix"
          aria-label="命令前缀"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          placeholder="!"
          @blur="commitPrefix"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
      </div>
      <SkeletonLoader v-else height="40px" />
    </div>

    <div>
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:timer-off-outline" class="text-lg opacity-60" />
        闲置自动退出
      </div>
      <p class="text-xs text-foreground-subtle mb-3">频道无人时，机器人自动断开的等待时间（0 = 不退出），失焦或回车即保存</p>
      <div v-if="loaded" class="flex items-center gap-2">
        <input
          v-model.number="localIdle"
          type="number"
          min="0"
          aria-label="闲置自动退出时间（分钟）"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          @blur="commitIdle"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <span class="text-sm text-foreground-muted">分钟</span>
      </div>
      <SkeletonLoader v-else height="40px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { usePlayerStore } from '../../stores/player';
import BaseToggle from '../common/BaseToggle.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';

const toast = useToast();
const loaded = ref(false);

const form = reactive({
  autoPauseOnEmpty: false,
  localAudioEnabled: false,
  savedQueuesEnabled: false,
  playKeepsQueue: false,
  voiceDuckingEnabled: false,
  voiceDuckingVolume: 30,
});

// 命令前缀/闲置超时：本地输入模型 + 已保存值（失败回滚用）
const localPrefix = ref('!');
const savedPrefix = ref('!');
const localIdle = ref(0);
const savedIdle = ref(0);

async function reload(): Promise<void> {
  const res = await http.get('/api/bot/settings');
  form.autoPauseOnEmpty = res.data.autoPauseOnEmpty === true;
  form.localAudioEnabled = res.data.localAudioEnabled === true;
  form.savedQueuesEnabled = res.data.savedQueuesEnabled === true;
  form.playKeepsQueue = res.data.playKeepsQueue === true;
  form.voiceDuckingEnabled = res.data.voiceDucking?.enabled === true;
  form.voiceDuckingVolume = res.data.voiceDucking?.volumePercent ?? 30;
  savedPrefix.value = res.data.commandPrefix ?? '!';
  localPrefix.value = savedPrefix.value;
  savedIdle.value = res.data.idleTimeoutMinutes ?? 0;
  localIdle.value = savedIdle.value;
}

onMounted(async () => {
  try {
    await reload();
    loaded.value = true;
  } catch {
    toast.error('读取行为设置失败');
  }
});

// ── 开关/闪避音量自动保存：500ms 防抖合并；与已保存快照一致时不发请求 ──
let lastSaved = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(form, () => {
  if (!loaded.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
});

// 审计 PERF-10：卸载时丢弃在途的防抖保存，避免离开页面后弹错误 toast
onUnmounted(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
});

function snapshot(): string {
  return JSON.stringify([
    form.autoPauseOnEmpty,
    form.localAudioEnabled,
    form.savedQueuesEnabled,
    form.playKeepsQueue,
    form.voiceDuckingEnabled,
    Math.min(100, Math.max(0, form.voiceDuckingVolume || 0)),
  ]);
}

async function persist() {
  if (snapshot() === lastSaved) return;
  try {
    await http.post('/api/bot/settings', {
      autoPauseOnEmpty: form.autoPauseOnEmpty,
      localAudioEnabled: form.localAudioEnabled,
      savedQueuesEnabled: form.savedQueuesEnabled,
      playKeepsQueue: form.playKeepsQueue,
      voiceDucking: {
        enabled: form.voiceDuckingEnabled,
        volumePercent: Math.min(100, Math.max(0, form.voiceDuckingVolume || 0)),
      },
    });
    // 审计 B4：队列抽屉的「已存清单」入口直接读 store——保存后立即同步，
    // 否则要刷新页面才生效。
    usePlayerStore().savedQueuesEnabled = form.savedQueuesEnabled;
    lastSaved = snapshot();
  } catch {
    toast.error('保存失败，已还原为上次保存的值');
    try {
      await reload();
    } catch {
      /* 读取也失败时保留本地值，下次改动会重试 */
    }
    lastSaved = snapshot();
  }
}

// ── 命令前缀/闲置超时：失焦/回车提交 ──
async function commitPrefix() {
  const v = localPrefix.value.trim() || '!';
  localPrefix.value = v;
  if (v === savedPrefix.value) return;
  try {
    await http.post('/api/bot/settings', { commandPrefix: v });
    savedPrefix.value = v;
  } catch {
    localPrefix.value = savedPrefix.value;
    toast.error('保存命令前缀失败');
  }
}

async function commitIdle() {
  const v = Math.max(0, Math.floor(Number(localIdle.value) || 0));
  localIdle.value = v;
  if (v === savedIdle.value) return;
  try {
    await http.post('/api/bot/settings', { idleTimeoutMinutes: v });
    savedIdle.value = v;
  } catch {
    localIdle.value = savedIdle.value;
    toast.error('保存闲置超时设置失败');
  }
}
</script>
