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
          aria-label="命令前缀"
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
          aria-label="闲置自动退出时间（分钟）"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <span class="text-sm text-foreground-muted">分钟</span>
        <BaseButton size="sm" @click="$emit('saveIdleTimeout', localIdle)">保存</BaseButton>
      </div>
    </div>

    <!-- Account / Password -->
    <div v-if="!auth.isGuest">
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:shield-key-outline" class="text-lg opacity-60" />
        账户安全
      </div>
      <div class="flex items-center justify-between gap-3 rounded-lg bg-interactive-hover px-4 py-3">
        <div>
          <div class="text-sm">登录密码</div>
          <p class="text-xs text-foreground-subtle mt-0.5">修改后其他设备的登录会自动注销，当前设备保持登录</p>
        </div>
        <BaseButton size="sm" @click="pwModalOpen = true">修改密码</BaseButton>
      </div>
    </div>

    <BaseModal v-model="pwModalOpen" title="修改密码">
      <form class="space-y-3" @submit.prevent="submitPassword">
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">当前密码</label>
          <input v-model="pwForm.old" type="password" autocomplete="current-password" class="input" required />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">新密码（至少 8 位）</label>
          <input v-model="pwForm.new" type="password" autocomplete="new-password" minlength="8" class="input" required />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">再次输入新密码</label>
          <input v-model="pwForm.confirm" type="password" autocomplete="new-password" minlength="8" class="input" required />
        </div>
        <p v-if="pwError" class="text-xs text-red-500">{{ pwError }}</p>
        <div class="flex justify-end gap-3 pt-2">
          <BaseButton type="button" variant="secondary" @click="pwModalOpen = false">取消</BaseButton>
          <BaseButton type="submit" :disabled="changingPw">{{ changingPw ? '提交中…' : '确认修改' }}</BaseButton>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BaseButton from '../common/BaseButton.vue';
import BaseModal from '../common/BaseModal.vue';
import { http } from '../../utils/http';
import { useToast } from '../../composables/useToast';
import { useAuthStore } from '../../stores/auth';

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

const auth = useAuthStore();
const toast = useToast();
const pwModalOpen = ref(false);
const pwForm = ref({ old: '', new: '', confirm: '' });
const pwError = ref('');
const changingPw = ref(false);

async function submitPassword() {
  pwError.value = '';
  if (pwForm.value.new !== pwForm.value.confirm) {
    pwError.value = '两次输入的新密码不一致';
    return;
  }
  if (pwForm.value.new.length < 8) {
    pwError.value = '新密码至少 8 位';
    return;
  }
  changingPw.value = true;
  try {
    await http.post('/api/session/change-password', {
      oldPassword: pwForm.value.old,
      newPassword: pwForm.value.new,
    });
    pwModalOpen.value = false;
    pwForm.value = { old: '', new: '', confirm: '' };
    toast.success('密码已更新，其他设备的登录已注销');
  } catch (err: unknown) {
    const status = (err as any)?.response?.status;
    if (status === 401) {
      pwError.value = '当前密码不正确';
    } else if (status === 400) {
      pwError.value = '新密码至少 8 位';
    } else {
      pwError.value = (err as any)?.response?.data?.error ?? '修改失败，请稍后再试';
    }
  } finally {
    changingPw.value = false;
  }
}
</script>
