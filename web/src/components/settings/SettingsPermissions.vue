<template>
  <div class="space-y-6">
    <div>
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:shield-key" class="text-lg opacity-60" />
        聊天命令权限
      </div>
      <p class="text-xs text-foreground-subtle mb-3">
        限制管理类命令（stop / clear / remove / move / vol / mode / reorder）仅限指定 TeamSpeak 服务器组的成员使用；留空 = 不限制（所有人可用）
      </p>
      <div v-if="loaded" class="flex items-center gap-2">
        <input
          v-model="adminGroupsInput"
          aria-label="服务器组 ID（逗号分隔）"
          class="w-64 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          placeholder="例如：6, 8"
        />
        <BaseButton size="sm" @click="saveAdminGroups">保存</BaseButton>
      </div>
      <SkeletonLoader v-else height="40px" />
      <p class="mt-2 text-xs text-foreground-subtle">
        组 ID 查看方式：TeamSpeak 客户端「权限 → 服务器组」对话框，选中组后标题栏显示其数字 ID
      </p>
    </div>

    <div class="border-t border-border-default pt-4">
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:walk" class="text-lg opacity-60" />
        游客模式
      </div>
      <p class="text-xs text-foreground-subtle mb-3">
        允许访客无需账号密码进入 WebUI 点歌。开启后登录页出现「以游客身份进入」
      </p>
      <div v-if="loaded" class="space-y-0.5">
        <BaseToggle
          v-model="guestEnabled"
          label="允许游客访问"
          hint="游客共享匿名身份、会话约 1 天；关闭后在线游客立即被断开"
        />
        <div class="pt-2 pb-1 pl-1 text-xs font-semibold text-foreground-muted">游客可执行的操作（默认仅第一项开启）</div>
        <BaseToggle v-for="f in guestFlags" :key="f.key" v-model="guestPerms[f.key]" :label="f.label" :hint="f.hint" />

        <!-- 审计 B3：游客可控机器人白名单（上游有；成员侧权限编辑器已有同款交互） -->
        <div class="pt-2 pb-1 pl-1 text-xs font-semibold text-foreground-muted">游客可见的机器人</div>
        <BaseToggle v-model="guestBotsAll" label="全部机器人" />
        <div v-if="!guestBotsAll" class="flex flex-col gap-1.5 mt-1 ml-4">
          <label v-for="bot in playerStore.bots" :key="bot.id" class="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-hover-bg cursor-pointer">
            <input v-model="guestSelectedBots" type="checkbox" :value="bot.id" class="accent-[var(--color-primary)]" />
            <span class="text-sm">{{ bot.name }}</span>
          </label>
          <p v-if="playerStore.bots.length === 0" class="text-xs text-text-tertiary px-3">还没有机器人</p>
        </div>
      </div>
      <SkeletonLoader v-else v-for="n in 3" :key="n" height="48px" class="mb-2" />

      <div class="mt-4 flex justify-end">
        <BaseButton :loading="saving" :disabled="!loaded" @click="saveGuestMode">保存游客设置</BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { usePlayerStore } from '../../stores/player';
import BaseButton from '../common/BaseButton.vue';
import BaseToggle from '../common/BaseToggle.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';

const toast = useToast();
const loaded = ref(false);
const saving = ref(false);

const adminGroupsInput = ref('');
const playerStore = usePlayerStore();
const guestEnabled = ref(false);
const guestPerms = reactive<Record<string, boolean>>({});
const guestBotsAll = ref(true);
const guestSelectedBots = ref<string[]>([]);

const guestFlags = [
  { key: 'addToQueue', label: '添加到队列末尾', hint: '搜索后加入播放队列' },
  { key: 'playNext', label: '添加到下一首', hint: '插播到当前歌曲之后' },
  { key: 'playNow', label: '立即播放', hint: '不清空队列直接播放' },
  { key: 'skip', label: '跳过当前歌曲', hint: '' },
  { key: 'transport', label: '暂停 / 继续 / 进度 / 音量', hint: '' },
  { key: 'removeClear', label: '移除 / 清空队列', hint: '' },
  { key: 'playMode', label: '切换播放模式 / FM', hint: '' },
  { key: 'playCollection', label: '播放整个歌单 / 专辑', hint: '' },
];

onMounted(async () => {
  try {
    const res = await http.get('/api/bot/settings');
    adminGroupsInput.value = (res.data.adminGroups ?? []).join(', ');
    guestEnabled.value = res.data.guestMode?.enabled === true;
    const perms = res.data.guestMode?.permissions ?? {};
    for (const f of guestFlags) {
      guestPerms[f.key] = perms[f.key] === true;
    }
    const bots = res.data.guestMode?.bots;
    if (bots === 'all' || bots === undefined) {
      guestBotsAll.value = true;
      guestSelectedBots.value = [];
    } else if (Array.isArray(bots)) {
      guestBotsAll.value = false;
      guestSelectedBots.value = bots.filter((b): b is string => typeof b === 'string');
    }
    loaded.value = true;
  } catch {
    toast.error('读取权限设置失败');
  }
});

function parseGroups(): number[] | null {
  const raw = adminGroupsInput.value.trim();
  if (!raw) return [];
  const parts = raw.split(/[,，\s]+/).filter(Boolean);
  const ids: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0) {
      toast.error(`无效的服务器组 ID：${p}（需为非负整数）`);
      return null;
    }
    ids.push(n);
  }
  return ids;
}

async function saveAdminGroups() {
  const groups = parseGroups();
  if (groups === null) return;
  try {
    await http.post('/api/bot/settings', { adminGroups: groups });
    toast.success(groups.length ? `命令权限已限定为服务器组 ${groups.join(', ')}` : '命令权限已恢复不限制');
  } catch {
    toast.error('保存命令权限失败');
  }
}

async function saveGuestMode() {
  saving.value = true;
  try {
    await http.post('/api/bot/settings', {
      guestMode: {
        enabled: guestEnabled.value,
        bots: guestBotsAll.value ? 'all' : [...guestSelectedBots.value],
        permissions: { ...guestPerms },
      },
    });
    toast.success('游客模式设置已保存');
  } catch {
    toast.error('保存游客设置失败');
  } finally {
    saving.value = false;
  }
}
</script>
