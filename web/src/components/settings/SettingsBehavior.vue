<template>
  <div class="space-y-6">
    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:tune" class="text-lg opacity-60" />
        播放行为
      </div>
      <div class="space-y-0.5" v-if="loaded">
        <BaseToggle
          v-model="form.autoPauseOnEmpty"
          label="频道无人时自动暂停"
          hint="机器人所在频道没有其他人时自动暂停，有人加入后自动恢复"
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

    <div class="flex justify-end">
      <BaseButton :loading="saving" :disabled="!loaded" @click="save">保存</BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import BaseButton from '../common/BaseButton.vue';
import BaseToggle from '../common/BaseToggle.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';

const toast = useToast();
const loaded = ref(false);
const saving = ref(false);

const form = reactive({
  autoPauseOnEmpty: false,
  localAudioEnabled: false,
  savedQueuesEnabled: false,
  playKeepsQueue: false,
  voiceDuckingEnabled: false,
  voiceDuckingVolume: 30,
});

onMounted(async () => {
  try {
    const res = await http.get('/api/bot/settings');
    form.autoPauseOnEmpty = res.data.autoPauseOnEmpty === true;
    form.localAudioEnabled = res.data.localAudioEnabled === true;
    form.savedQueuesEnabled = res.data.savedQueuesEnabled === true;
    form.playKeepsQueue = res.data.playKeepsQueue === true;
    form.voiceDuckingEnabled = res.data.voiceDucking?.enabled === true;
    form.voiceDuckingVolume = res.data.voiceDucking?.volumePercent ?? 30;
    loaded.value = true;
  } catch {
    toast.error('读取行为设置失败');
  }
});

async function save() {
  saving.value = true;
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
    toast.success('行为设置已保存');
  } catch {
    toast.error('保存行为设置失败');
  } finally {
    saving.value = false;
  }
}
</script>
