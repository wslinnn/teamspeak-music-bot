<template>
  <nav class="fixed top-0 left-0 right-0 h-[var(--navbar-height)] flex items-center px-[10vw] z-[100] border-b border-border-color frosted-glass max-[1336px]:px-[5vw]">
    <RouterLink to="/" class="text-lg font-bold text-primary mr-10">TSMusicBot</RouterLink>

    <!-- Desktop nav links -->
    <div class="hidden md:flex gap-6">
      <RouterLink to="/" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">发现</RouterLink>
      <RouterLink to="/search" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">搜索</RouterLink>
      <RouterLink to="/history" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">播放历史</RouterLink>
      <RouterLink to="/favorites" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">收藏</RouterLink>
    </div>

    <!-- Mobile hamburger -->
    <button class="md:hidden ml-auto p-2 text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="mobileMenuOpen = !mobileMenuOpen">
      <Icon :icon="mobileMenuOpen ? 'mdi:close' : 'mdi:menu'" class="text-2xl" />
    </button>

    <div class="ml-auto flex items-center gap-4">
      <!-- Bot selector (always shown when at least one bot exists) -->
      <div v-if="store.bots.length > 0" class="relative" ref="selectorRef">
        <button class="flex items-center gap-2.5 px-5 py-2.5 bg-hover-bg rounded-[var(--radius-md)] text-base font-semibold min-h-[44px] border border-border-color transition-colors duration-[var(--transition-fast)] cursor-pointer hover:bg-bg-card hover:border-primary" @click="dropdownOpen = !dropdownOpen">
          <span class="w-2.5 h-2.5 rounded-full bg-text-tertiary shrink-0" :class="{ 'bg-green-500': activeBot?.connected }" />
          <span class="hidden sm:inline max-w-[160px] truncate whitespace-nowrap">{{ activeBot?.name ?? '选择机器人' }}</span>
          <span v-if="activeBot?.playing && !activeBot?.paused" class="text-sm text-green-500">▶</span>
          <span v-else-if="activeBot?.paused" class="text-sm text-yellow-500">⏸</span>
          <Icon icon="mdi:chevron-down" class="text-xl opacity-50 transition-transform duration-200" :class="{ 'rotate-180': dropdownOpen }" />
        </button>
        <div v-if="dropdownOpen" class="absolute top-[calc(100%+6px)] right-0 min-w-[200px] bg-bg-secondary border border-border-color rounded-[var(--radius-md)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.2)] z-[200]">
          <div
            v-for="bot in store.bots"
            :key="bot.id"
            class="flex items-center gap-0.5"
          >
            <button
              class="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-[var(--radius-sm)] text-[13px] cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-hover-bg"
              :class="{ 'bg-[rgba(51,94,234,0.12)] text-primary': bot.id === store.activeBotId }"
              @click="selectBot(bot.id)"
            >
              <span class="w-2.5 h-2.5 rounded-full bg-text-tertiary shrink-0" :class="{ 'bg-green-500': bot.connected }" />
              <span class="flex-1 min-w-0 truncate whitespace-nowrap">{{ bot.name }}</span>
              <span v-if="bot.playing && !bot.paused" class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-[rgba(34,197,94,0.15)] text-green-500">播放中</span>
              <span v-else-if="bot.paused" class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-[rgba(234,179,8,0.15)] text-yellow-500">已暂停</span>
              <span v-else-if="bot.connected" class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-[rgba(51,94,234,0.12)] text-primary">空闲</span>
              <span v-else class="text-[11px] px-1.5 py-px rounded font-medium shrink-0 bg-hover-bg text-text-tertiary">离线</span>
            </button>
            <button
              v-if="authStore.isAdmin"
              class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
              :class="{ 'text-green-500 opacity-90': bot.connected }"
              :title="bot.connected ? `停止 ${bot.name}` : `启动 ${bot.name}`"
              :disabled="togglingBots[bot.id]"
              @click.stop="togglePower(bot)"
            >
              <Icon :icon="bot.connected ? 'mdi:power' : 'mdi:power-off'" />
            </button>
            <button
              v-if="authStore.isAdmin"
              class="shrink-0 p-1.5 px-2 rounded-[var(--radius-sm)] text-[15px] opacity-40 transition-opacity duration-[var(--transition-fast)] cursor-pointer hover:opacity-100 hover:bg-hover-bg"
              :title="`复制 ${bot.name} 的专属链接`"
              @click.stop="copyBotLink(bot.id)"
            >
              <Icon icon="mdi:link-variant" />
            </button>
          </div>
          <div class="h-px bg-border-color my-1" />
          <div class="px-3 py-1 pb-1.5 text-[11px] text-text-tertiary text-center">点击切换 · 🔗 复制专属链接</div>
        </div>
      </div>

      <RouterLink v-if="authStore.isAdmin" to="/settings" class="text-[22px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100">
        <Icon icon="mdi:cog" />
      </RouterLink>
    </div>
  </nav>

  <!-- Mobile menu overlay -->
  <Transition name="mobile-menu">
    <div v-if="mobileMenuOpen" class="fixed inset-[var(--navbar-height)]_0_0_0 bg-black/50 z-[99] backdrop-blur-sm md:hidden" @click="mobileMenuOpen = false">
      <div class="absolute top-0 right-0 w-60 max-w-[80vw] bg-bg-secondary border-l border-border-color p-3 flex flex-col gap-1" @click.stop>
        <RouterLink to="/" class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg" active-class="opacity-100 !text-primary bg-[rgba(51,94,234,0.1)]" @click="mobileMenuOpen = false">
          <Icon icon="mdi:home" class="mr-3" /> 发现
        </RouterLink>
        <RouterLink to="/search" class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg" active-class="opacity-100 !text-primary bg-[rgba(51,94,234,0.1)]" @click="mobileMenuOpen = false">
          <Icon icon="mdi:magnify" class="mr-3" /> 搜索
        </RouterLink>
        <RouterLink to="/history" class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg" active-class="opacity-100 !text-primary bg-[rgba(51,94,234,0.1)]" @click="mobileMenuOpen = false">
          <Icon icon="mdi:history" class="mr-3" /> 播放历史
        </RouterLink>
        <RouterLink to="/favorites" class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg" active-class="opacity-100 !text-primary bg-[rgba(51,94,234,0.1)]" @click="mobileMenuOpen = false">
          <Icon icon="mdi:heart" class="mr-3" /> 收藏
        </RouterLink>
        <RouterLink
          v-if="authStore.isAdmin"
          to="/settings"
          class="flex items-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-medium opacity-70 transition-all duration-[var(--transition-fast)] hover:opacity-90 hover:bg-hover-bg"
          active-class="opacity-100 !text-primary bg-[rgba(51,94,234,0.1)]"
          @click="mobileMenuOpen = false"
        >
          <Icon icon="mdi:cog" class="mr-3" /> 设置
        </RouterLink>
      </div>
    </div>
  </Transition>

  <div v-if="linkDialog.open" class="fixed inset-0 bg-black/55 flex items-center justify-center z-[1000]" @click="closeLinkDialog">
    <div class="bg-bg-secondary border border-border-color rounded-[var(--radius-md)] p-5 min-w-[360px] max-w-[90vw] shadow-[0_12px_40px_rgba(0,0,0,0.35)]" @click.stop>
      <div class="text-[15px] font-semibold mb-1.5">{{ linkDialog.name }} 的专属链接</div>
      <div class="text-xs text-text-tertiary mb-3">选中文本并按 Ctrl/Cmd+C 复制，或点击下方按钮</div>
      <input
        ref="linkInputRef"
        class="w-full px-3 py-2.5 text-[13px] font-mono bg-hover-bg border border-border-color rounded-[var(--radius-sm)] text-inherit user-select-all focus:outline-none focus:border-primary"
        :value="linkDialog.url"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
      />
      <div class="flex justify-end gap-2 mt-3.5">
        <button class="px-4 py-2 text-[13px] font-medium rounded-[var(--radius-sm)] border border-border-color bg-hover-bg text-inherit cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-bg-card bg-primary border-primary text-white" @click="copyLinkFromDialog">
          {{ linkDialog.copied ? '已复制' : '复制链接' }}
        </button>
        <button class="px-4 py-2 text-[13px] font-medium rounded-[var(--radius-sm)] border border-border-color bg-hover-bg text-inherit cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-bg-card" @click="closeLinkDialog">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, reactive } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';

const store = usePlayerStore();
const authStore = useAuthStore();
const activeBot = computed(() => store.activeBot);
const dropdownOpen = ref(false);
const mobileMenuOpen = ref(false);
const selectorRef = ref<HTMLElement | null>(null);
const togglingBots = ref<Record<string, boolean>>({});
const linkInputRef = ref<HTMLInputElement | null>(null);
const publicBaseUrl = ref<string | null>(null);

const linkDialog = reactive({
  open: false,
  url: '',
  name: '',
  copied: false,
});

function selectBot(id: string) {
  store.setActiveBotId(id);
  dropdownOpen.value = false;
}

function resolveBaseUrl(): string {
  const base = publicBaseUrl.value;
  if (base && /^https?:\/\//i.test(base)) return base.replace(/\/+$/, '');
  return window.location.origin;
}

async function tryClipboardWrite(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('Clipboard write failed, falling back to execCommand:', err);
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
  } catch (err) {
    console.warn('execCommand copy failed:', err);
    return false;
  }
}

async function copyBotLink(id: string) {
  const bot = store.bots.find((b) => b.id === id);
  const url = `${resolveBaseUrl()}/bot/${id}`;
  linkDialog.url = url;
  linkDialog.name = bot?.name ?? '机器人';
  linkDialog.copied = false;
  linkDialog.open = true;
  dropdownOpen.value = false;
  const ok = await tryClipboardWrite(url);
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

function closeLinkDialog() {
  linkDialog.open = false;
}

async function loadPublicBaseUrl() {
  try {
    const res = await fetch('/api/config/public-url');
    if (!res.ok) return;
    const data = (await res.json()) as { publicUrl?: string | null };
    if (data.publicUrl) publicBaseUrl.value = data.publicUrl;
  } catch (err) {
    console.warn('Failed to load public base URL, falling back to origin:', err);
  }
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
.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: opacity 0.2s ease;
}
.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
}
</style>
