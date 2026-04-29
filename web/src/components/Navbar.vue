<template>
  <nav class="fixed top-0 left-0 right-0 h-[var(--navbar-height)] flex items-center px-[10vw] z-[100] frosted-glass max-[1336px]:px-[5vw]">
    <RouterLink to="/" class="text-lg font-bold text-primary mr-10">TSMusicBot</RouterLink>

    <!-- Desktop nav links -->
    <div class="hidden md:flex gap-6">
      <RouterLink to="/" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">发现</RouterLink>
      <RouterLink to="/search" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">搜索</RouterLink>
      <RouterLink to="/history" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">播放历史</RouterLink>
      <RouterLink to="/favorites" class="text-sm font-semibold opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-80" active-class="opacity-100 !text-primary">收藏</RouterLink>
    </div>

    <div class="ml-auto flex items-center gap-2 md:gap-4">
      <!-- Bot selector (always shown when at least one bot exists) -->
      <div v-if="store.bots.length > 0" class="relative" ref="selectorRef">
        <button class="flex items-center gap-2 md:gap-2.5 px-3 md:px-5 py-2 md:py-2.5 bg-bg-secondary rounded-[var(--radius-md)] text-base font-semibold min-h-[44px] transition-colors duration-[var(--transition-fast)] cursor-pointer hover:bg-hover-bg" @click="dropdownOpen = !dropdownOpen">
          <span class="w-2.5 h-2.5 rounded-full bg-text-tertiary shrink-0" :class="{ 'bg-green-500': activeBot?.connected }" />
          <span class="hidden sm:inline max-w-[160px] truncate whitespace-nowrap">{{ activeBot?.name ?? '选择机器人' }}</span>
          <Icon v-if="activeBot?.playing && !activeBot?.paused" icon="mdi:play" class="text-sm text-green-500" />
          <Icon v-else-if="activeBot?.paused" icon="mdi:pause" class="text-sm text-yellow-500" />
          <Icon icon="mdi:chevron-down" class="text-xl opacity-50 transition-transform duration-200" :class="{ 'rotate-180': dropdownOpen }" />
        </button>
        <div v-if="dropdownOpen" class="absolute top-[calc(100%+6px)] right-0 w-[calc(100vw-32px)] max-w-[260px] min-w-[200px] bg-bg-secondary rounded-[var(--radius-md)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.3)] z-[200]">
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
          </div>
          <div class="h-px my-1" />
          <div class="px-3 py-1 pb-1.5 text-[11px] text-text-tertiary text-center">点击切换机器人</div>
        </div>
      </div>

      <button class="text-[22px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100 p-1" @click="store.toggleTheme()">
        <Icon :icon="store.theme === 'dark' ? 'mdi:weather-night' : 'mdi:white-balance-sunny'" />
      </button>
      <!-- Desktop-only auth controls -->
      <div class="hidden md:flex items-center gap-4">
        <RouterLink v-if="authStore.authEnabled && !authStore.isAuthenticated" to="/login" class="text-sm font-semibold px-4 py-1.5 rounded-[var(--radius-md)] bg-primary text-white transition-colors duration-[var(--transition-fast)] hover:brightness-110">
          管理员登录
        </RouterLink>
        <RouterLink v-if="authStore.authEnabled && authStore.isAuthenticated" to="/settings" class="text-[22px] opacity-60 transition-opacity duration-[var(--transition-fast)] hover:opacity-100">
          <Icon icon="mdi:cog" />
        </RouterLink>
        <div v-if="authStore.authEnabled && authStore.isAuthenticated" class="flex items-center gap-2 ml-1 pl-3 border-l border-border-color">
          <div class="flex items-center gap-1.5 text-sm text-text-secondary">
            <Icon icon="mdi:shield-account" class="text-lg" />
            <span>管理员</span>
          </div>
          <button class="text-[18px] opacity-50 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" title="退出登录" @click="handleLogout">
            <Icon icon="mdi:logout" />
          </button>
        </div>
      </div>

      <!-- Mobile hamburger -->
      <button class="md:hidden p-2 text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="mobileMenuOpen = !mobileMenuOpen">
        <Icon :icon="mobileMenuOpen ? 'mdi:close' : 'mdi:menu'" class="text-2xl" />
      </button>
    </div>
  </nav>

  <!-- Mobile menu overlay -->
  <Transition name="mobile-menu">
    <div v-if="mobileMenuOpen" class="fixed top-[var(--navbar-height)] right-0 bottom-0 left-0 bg-black/50 z-[99] backdrop-blur-sm md:hidden" @click="mobileMenuOpen = false">
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

        <!-- Mobile auth section -->
        <div class="mt-2 pt-2 border-t border-border-color">
          <RouterLink
            v-if="authStore.authEnabled && !authStore.isAuthenticated"
            to="/login"
            class="flex items-center justify-center px-4 py-3 rounded-[var(--radius-md)] text-[15px] font-semibold bg-primary text-white transition-all duration-[var(--transition-fast)] hover:brightness-110"
            @click="mobileMenuOpen = false"
          >
            <Icon icon="mdi:login" class="mr-3" /> 管理员登录
          </RouterLink>

          <div v-if="authStore.authEnabled && authStore.isAuthenticated" class="flex items-center justify-between px-4 py-3">
            <div class="flex items-center gap-2 text-[15px] font-medium text-text-secondary">
              <Icon icon="mdi:shield-account" class="text-lg" />
              <span>管理员</span>
            </div>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-[13px] font-medium opacity-60 transition-all duration-[var(--transition-fast)] hover:opacity-100 hover:bg-hover-bg"
              @click="handleLogout(); mobileMenuOpen = false"
            >
              <Icon icon="mdi:logout" /> 退出
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>

</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';

const store = usePlayerStore();
const authStore = useAuthStore();
const router = useRouter();
const activeBot = computed(() => store.activeBot);
const dropdownOpen = ref(false);
const mobileMenuOpen = ref(false);
const selectorRef = ref<HTMLElement | null>(null);
const togglingBots = ref<Record<string, boolean>>({});

function handleLogout() {
  authStore.logout();
  router.push('/login');
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
