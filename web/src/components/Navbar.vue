<template>
  <nav class="fixed top-0 left-0 right-0 h-[var(--navbar-height)] z-[var(--z-navbar)] frosted-glass">
    <!-- 内层容器与 .main-content 的 max-w/边距对齐，保证导航与内容左缘同线 -->
    <div class="mx-auto flex h-full w-full max-w-[1280px] items-center px-[18px] md:px-8">
    <RouterLink to="/" class="text-lg font-bold text-primary mr-4 md:mr-10 max-[380px]:text-base">TSMusicBot</RouterLink>

    <!-- Desktop nav links -->
    <div class="hidden md:flex gap-6">
      <RouterLink
        v-for="link in desktopLinks"
        :key="link.to"
        :to="link.to"
        class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80"
        active-class="opacity-100 !text-primary"
      >{{ link.label }}</RouterLink>
      <button
        class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80 flex items-center gap-1"
        @click="serverTreeOpen = true"
      >
        <Icon icon="mdi:server" /> 服务器
      </button>
    </div>

    <div class="ml-auto flex items-center gap-2 md:gap-4">
      <!-- Bot selector (always shown when at least one bot exists) -->
      <div v-if="store.isScoped" class="flex items-center gap-1.5">
        <div class="flex items-center gap-2 md:gap-2.5 px-3 md:px-5 py-2 md:py-2.5 bg-bg-secondary rounded-[var(--radius-md)] text-base font-semibold min-h-[44px]">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="activeBot?.connected ? 'bg-success' : 'bg-text-tertiary'" />
          <span class="hidden sm:inline max-w-[160px] truncate whitespace-nowrap">{{ activeBot?.name ?? '专属机器人' }}</span>
          <span class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-warning/15 text-warning">专属模式</span>
        </div>
        <button
          class="px-2.5 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100 hover:bg-hover-bg"
          title="退出专属模式"
          @click="exitScope"
        >
          退出
        </button>
      </div>
      <div v-else-if="store.bots.length > 0" class="relative" ref="selectorRef">
        <button class="flex items-center gap-2 md:gap-2.5 px-3 md:px-5 py-2 md:py-2.5 bg-bg-secondary rounded-[var(--radius-md)] text-base font-semibold min-h-[44px] transition-colors duration-[var(--transition-fast)] cursor-pointer hover:bg-hover-bg" @click="dropdownOpen = !dropdownOpen">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="activeBot?.connected ? 'bg-success' : 'bg-text-tertiary'" />
          <span class="hidden sm:inline max-w-[160px] truncate whitespace-nowrap">{{ activeBot?.name ?? '选择机器人' }}</span>
          <Icon v-if="activeBot?.playing && !activeBot?.paused" icon="mdi:play" class="text-sm text-success" />
          <Icon v-else-if="activeBot?.paused" icon="mdi:pause" class="text-sm text-warning" />
          <Icon icon="mdi:chevron-down" class="text-xl opacity-50 transition-transform duration-200" :class="{ 'rotate-180': dropdownOpen }" />
        </button>
        <div v-if="dropdownOpen" class="absolute top-[calc(100%+6px)] right-0 w-[calc(100vw-32px)] max-w-[260px] min-w-[200px] bg-bg-secondary rounded-[var(--radius-md)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.3)] max-md:fixed max-md:top-[calc(var(--navbar-height)+4px)] max-md:left-3 max-md:right-3 max-md:w-auto max-md:min-w-0 max-md:max-w-none">
          <div
            v-for="bot in store.bots"
            :key="bot.id"
            class="flex items-center gap-0.5"
          >
            <button
              class="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-[var(--radius-sm)] text-[13px] cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-hover-bg"
              :class="{ 'bg-primary/10 text-primary': bot.id === store.activeBotId }"
              @click="selectBot(bot.id)"
            >
              <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="bot.connected ? 'bg-success' : 'bg-text-tertiary'" />
              <span class="flex-1 min-w-0 truncate whitespace-nowrap">{{ bot.name }}</span>
              <span v-if="bot.playing && !bot.paused" class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-success/15 text-success">播放中</span>
              <span v-else-if="bot.paused" class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-warning/15 text-warning">已暂停</span>
              <span v-else-if="bot.connected" class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-primary/10 text-primary">空闲</span>
              <span v-else class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-hover-bg text-text-tertiary">离线</span>
            </button>
            <button
              v-if="!authStore.isGuest"
              class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
              :class="{ 'text-success opacity-90': bot.connected }"
              :title="bot.connected ? `停止 ${bot.name}` : `启动 ${bot.name}`"
              :disabled="togglingBots[bot.id]"
              @click.stop="togglePower(bot)"
            >
              <Icon :icon="bot.connected ? 'mdi:power' : 'mdi:power-off'" />
            </button>
            <template v-if="canControl">
              <button
                v-if="bot.playing || bot.paused"
                class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
                :disabled="!bot.connected"
                title="停止播放"
                @click.stop="store.pause()"
              >
                <Icon icon="mdi:stop" />
              </button>
              <button
                v-else
                class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
                :disabled="!bot.connected"
                title="播放"
                @click.stop="store.resume()"
              >
                <Icon icon="mdi:play" />
              </button>
              <button
                class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
                :disabled="!bot.connected || (!bot.playing && !bot.paused)"
                title="下一首"
                @click.stop="store.next()"
              >
                <Icon icon="mdi:skip-next" />
              </button>
            </template>
            <button
              class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
              title="复制专属链接"
              @click.stop="copyBotLink(bot.id)"
            >
              <Icon icon="mdi:link-variant" />
            </button>
          </div>
          <div class="h-px my-1" />
          <div class="px-3 py-1 pb-1.5 text-[11px] text-text-tertiary text-center">点击切换机器人</div>
        </div>
      </div>

      <button class="text-[22px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center" :title="store.theme === 'auto' ? '主题：跟随系统' : '切换主题'" @click="store.toggleTheme()">
        <Icon :icon="store.theme === 'auto' ? 'mdi:theme-light-dark' : store.resolvedTheme === 'dark' ? 'mdi:weather-night' : 'mdi:white-balance-sunny'" />
      </button>
      <!-- 服务器状态：移动端经此进入（桌面走左侧链接） -->
      <button class="md:hidden text-[20px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="服务器状态" @click="serverTreeOpen = true">
        <Icon icon="mdi:server" />
      </button>
      <!-- 登录：仅移动端（桌面走下方 Desktop-only 区）；游客已认证则给退出入口 -->
      <RouterLink v-if="!authStore.isAuthenticated" to="/login" class="md:hidden text-sm font-semibold px-3 py-1.5 rounded-[var(--radius-md)] bg-primary text-white transition-colors duration-[var(--transition-fast)] hover:brightness-110">
        登录
      </RouterLink>
      <button
        v-if="authStore.isAuthenticated && authStore.isGuest"
        class="md:hidden text-[20px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="退出游客模式"
        aria-label="退出游客模式"
        @click="handleLogout"
      >
        <Icon icon="mdi:logout" />
      </button>
      <!-- Desktop-only auth controls -->
      <div class="hidden md:flex items-center gap-4">
        <RouterLink v-if="!authStore.isAuthenticated" to="/login" class="text-sm font-semibold px-4 py-1.5 rounded-[var(--radius-md)] bg-primary text-white transition-colors duration-[var(--transition-fast)] hover:brightness-110">
          登录
        </RouterLink>
        <RouterLink v-if="!authStore.isGuest" to="/settings" class="text-[22px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100 flex items-center justify-center min-h-[44px] min-w-[44px]">
          <Icon icon="mdi:cog" />
        </RouterLink>
        <div v-if="authStore.isAuthenticated" class="flex items-center gap-2 ml-1 pl-3 border-l border-border-color">
          <div class="flex items-center gap-1.5 text-sm text-text-secondary" :title="authStore.roleLabel">
            <Icon :icon="authStore.isAdmin ? 'mdi:shield-account' : authStore.isGuest ? 'mdi:walk' : 'mdi:account'" class="text-lg" />
            <span>{{ authStore.username }}</span>
          </div>
          <button class="text-[18px] opacity-50 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" title="退出登录" @click="handleLogout">
            <Icon icon="mdi:logout" />
          </button>
        </div>
      </div>
    </div>
    </div>
  </nav>

  <ServerTreeDrawer v-model="serverTreeOpen" />

  <!-- 专属链接弹窗（复制失败时可手动选中文本复制） -->
  <BaseModal v-model="linkDialog.open" :title="`${linkDialog.name} 的专属链接`">
    <p class="text-xs text-foreground-subtle mb-3">打开该链接的访客将只看到并控制这台机器人</p>
    <input ref="linkInputRef" class="input" :value="linkDialog.url" readonly @focus="($event.target as HTMLInputElement).select()" />
    <template #footer>
      <BaseButton variant="secondary" @click="linkDialog.open = false">关闭</BaseButton>
      <BaseButton @click="copyLinkFromDialog">{{ linkDialog.copied ? '已复制' : '复制链接' }}</BaseButton>
    </template>
  </BaseModal>

</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';
import { http } from '../utils/http';
import ServerTreeDrawer from './ServerTreeDrawer.vue';
import BaseModal from './common/BaseModal.vue';
import BaseButton from './common/BaseButton.vue';

const store = usePlayerStore();
const authStore = useAuthStore();
const router = useRouter();
const activeBot = computed(() => store.activeBot);
// bot 快捷操作（停止/播放/下一首）需 player.control（与 Player 底栏同口径）
const canControl = computed(() => authStore.can('player.control'));

// 桌面导航数据化：播放历史/收藏并入「我的」（/library 子 Tab）；游客不可见（与路由 blockGuest 对应）
const desktopLinks = computed(() => [
  { to: '/', label: '发现' },
  { to: '/search', label: '搜索' },
  ...(!authStore.isGuest ? [{ to: '/library', label: '我的' }] : []),
]);


const dropdownOpen = ref(false);
const serverTreeOpen = ref(false);
const selectorRef = ref<HTMLElement | null>(null);
const togglingBots = ref<Record<string, boolean>>({});

// ── 专属链接（D13）──
const publicBaseUrl = ref('');
const linkInputRef = ref<HTMLInputElement | null>(null);
const linkDialog = reactive({ open: false, url: '', name: '', copied: false });

async function loadPublicBaseUrl() {
  try {
    const res = await http.get('/api/config/public-url');
    if (res.data.publicUrl) publicBaseUrl.value = res.data.publicUrl as string;
  } catch {
    // 忽略——回退到 window.location.origin
  }
}

function resolveBaseUrl(): string {
  return publicBaseUrl.value || window.location.origin;
}

async function tryClipboardWrite(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到 execCommand 兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyBotLink(id: string) {
  const bot = store.bots.find((b) => b.id === id);
  linkDialog.url = `${resolveBaseUrl()}/bot/${id}`;
  linkDialog.name = bot?.name ?? '机器人';
  linkDialog.copied = false;
  linkDialog.open = true;
  // 静默尝试直接复制；失败时用户可在弹窗里手动复制
  const ok = await tryClipboardWrite(linkDialog.url);
  if (ok) linkDialog.copied = true;
  await nextTick();
  linkInputRef.value?.focus();
  linkInputRef.value?.select();
}

async function copyLinkFromDialog() {
  const ok = await tryClipboardWrite(linkDialog.url);
  if (ok) {
    linkDialog.copied = true;
  } else {
    linkInputRef.value?.focus();
    linkInputRef.value?.select();
  }
}

/** 退出专属模式：先清 scope 再跳转，路由守卫看到空 scope 才不会把 ?bot= 补回来 */
function exitScope() {
  store.clearScope();
  dropdownOpen.value = false;
  router.push('/');
}

function handleLogout() {
  // 整页重载回登录页：与登录流程对齐，应用以未登录状态完整重建
  authStore.logout();
  window.location.replace('/login');
}

function selectBot(id: string) {
  store.setActiveBotId(id);
  dropdownOpen.value = false;
}

async function togglePower(bot: { id: string; connected: boolean; name: string }) {
  if (togglingBots.value[bot.id]) return;
  togglingBots.value[bot.id] = true;
  try {
    if (bot.connected) {
      await store.stopBotInstance(bot.id);
    } else {
      await store.startBotInstance(bot.id);
    }
  } catch (err) {
    console.error(`Failed to toggle bot ${bot.name}`, err);
  } finally {
    togglingBots.value[bot.id] = false;
  }
}

function onClickOutside(e: MouseEvent) {
  if (selectorRef.value && !selectorRef.value.contains(e.target as Node)) {
    dropdownOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
  loadPublicBaseUrl();
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
});
</script>

<style scoped>

</style>
