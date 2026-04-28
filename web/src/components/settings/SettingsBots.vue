<template>
  <div class="space-y-4">
    <!-- Bot List -->
    <div class="flex flex-col gap-2">
      <div
        v-for="bot in bots"
        :key="bot.id"
        class="flex items-center justify-between rounded-lg bg-interactive-hover px-4 py-3"
      >
        <div class="flex items-center gap-3">
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :class="bot.connected ? 'bg-success' : 'bg-foreground-subtle'"
          />
          <div>
            <div class="text-sm font-medium">{{ bot.name }}</div>
            <span
              class="inline-block text-xs px-2 py-0.5 rounded mt-0.5"
              :class="statusClass(bot)"
            >
              {{ statusText(bot) }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <BaseButton size="sm" variant="secondary" @click="$emit('toggleBot', bot.id, bot.connected)">
            {{ bot.connected ? '停止' : '启动' }}
          </BaseButton>
          <BaseButton size="sm" variant="ghost" @click="$emit('editBot', bot)">
            <Icon icon="mdi:pencil" />
          </BaseButton>
          <BaseButton size="sm" variant="ghost" class="hover:text-danger" @click="$emit('deleteBot', bot.id, bot.name)">
            <Icon icon="mdi:delete" />
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Create Bot -->
    <div class="border-t border-border-default pt-4 mt-4">
      <h4 class="text-sm font-semibold mb-3">创建新实例</h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="block text-xs font-semibold opacity-70 mb-1">名称</label>
          <input v-model="form.name" class="input" placeholder="我的音乐机器人" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器地址</label>
          <input v-model="form.serverAddress" class="input" placeholder="localhost" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">端口</label>
          <input v-model.number="form.serverPort" type="number" class="input" placeholder="9987" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs font-semibold opacity-70 mb-1">昵称</label>
          <input v-model="form.nickname" class="input" placeholder="MusicBot" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">默认频道（可选）</label>
          <input v-model="form.defaultChannel" class="input" placeholder="音乐频道" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器密码（可选）</label>
          <input v-model="form.serverPassword" type="password" class="input" />
        </div>
      </div>
      <BaseButton class="mt-3" @click="submitCreate">创建</BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { Icon } from '@iconify/vue';
import type { BotStatus } from '../../stores/player';
import BaseButton from '../common/BaseButton.vue';

const props = defineProps<{ bots: BotStatus[] }>();
const emit = defineEmits<{
  (e: 'toggleBot', botId: string, connected: boolean): void;
  (e: 'editBot', bot: BotStatus): void;
  (e: 'deleteBot', botId: string, botName: string): void;
  (e: 'createBot', form: { name: string; serverAddress: string; serverPort: number; nickname: string; defaultChannel: string; serverPassword: string }): void;
}>();

const form = reactive({
  name: '',
  serverAddress: '',
  serverPort: 9987,
  nickname: 'MusicBot',
  defaultChannel: '',
  serverPassword: '',
});

function submitCreate() {
  emit('createBot', { ...form });
  form.name = '';
  form.serverAddress = '';
  form.serverPort = 9987;
  form.nickname = 'MusicBot';
  form.defaultChannel = '';
  form.serverPassword = '';
}

function statusText(bot: BotStatus) {
  if (!bot.connected) return '离线';
  if (bot.playing) return '播放中';
  if (bot.paused) return '已暂停';
  return '在线';
}

function statusClass(bot: BotStatus) {
  if (!bot.connected) return 'bg-foreground-subtle/10 text-foreground-subtle';
  if (bot.playing) return 'bg-success/15 text-success';
  if (bot.paused) return 'bg-warning/15 text-warning';
  return 'bg-primary/15 text-primary';
}
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
