<template>
  <div class="space-y-6">
    <!-- Audio Quality -->
    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:music-note-eighth" class="text-lg opacity-60" />
        音源质量
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <button
          v-for="q in qualityLevels"
          :key="q.value"
          class="rounded-lg border-2 p-3 text-center transition-all"
          :class="currentQuality === q.value
            ? 'border-primary bg-primary/10'
            : 'border-transparent bg-interactive-hover hover:border-border-default'"
          @click="$emit('setQuality', q.value)"
        >
          <div class="text-sm font-semibold">{{ q.label }}</div>
          <div class="text-xs text-foreground-subtle mt-0.5">{{ q.desc }}</div>
        </button>
      </div>
    </div>

    <!-- Command Prefix -->
    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:console" class="text-lg opacity-60" />
        命令前缀
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="localPrefix"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          placeholder="!"
        />
        <BaseButton size="sm" @click="$emit('savePrefix', localPrefix)">保存</BaseButton>
      </div>
    </div>

    <!-- Idle Timeout -->
    <div>
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:timer-off-outline" class="text-lg opacity-60" />
        闲置自动退出
      </div>
      <p class="text-xs text-foreground-subtle mb-3">频道无人时，机器人自动断开的等待时间（0 = 不退出）</p>
      <div class="flex items-center gap-2">
        <input
          v-model.number="localIdle"
          type="number"
          min="0"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <span class="text-sm text-foreground-muted">分钟</span>
        <BaseButton size="sm" @click="$emit('saveIdleTimeout', localIdle)">保存</BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BaseButton from '../common/BaseButton.vue';

const qualityLevels = [
  { value: 'standard', label: '标准', desc: '128kbps MP3' },
  { value: 'higher', label: '较高', desc: '192kbps MP3' },
  { value: 'exhigh', label: '极高', desc: '320kbps MP3' },
  { value: 'lossless', label: '无损', desc: 'FLAC' },
  { value: 'hires', label: 'Hi-Res', desc: '高解析度' },
  { value: 'jymaster', label: '超清母带', desc: '最高质量' },
];

const props = defineProps<{
  currentQuality: string;
  commandPrefix: string;
  idleTimeout: number;
}>();

const emit = defineEmits<{
  (e: 'setQuality', value: string): void;
  (e: 'savePrefix', value: string): void;
  (e: 'saveIdleTimeout', value: number): void;
}>();

const localPrefix = ref(props.commandPrefix);
const localIdle = ref(props.idleTimeout);

watch(() => props.commandPrefix, (v) => { localPrefix.value = v; });
watch(() => props.idleTimeout, (v) => { localIdle.value = v; });
</script>
