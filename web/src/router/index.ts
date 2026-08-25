import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { usePlayerStore } from '../stores/player';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/Home.vue'),
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('../views/Search.vue'),
    },
    {
      path: '/playlist/:id',
      name: 'playlist',
      component: () => import('../views/Playlist.vue'),
      meta: { kind: 'playlist' },
    },
    {
      path: '/album/:id',
      name: 'album',
      component: () => import('../views/Playlist.vue'),
      meta: { kind: 'album' },
    },
    {
      path: '/lyrics',
      name: 'lyrics',
      component: () => import('../views/Lyrics.vue'),
      meta: { hideNavbar: true },
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('../views/History.vue'),
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('../views/Library.vue'),
      meta: { blockGuest: true },
    },
    {
      path: '/favorites',
      name: 'favorites',
      component: () => import('../views/Favorites.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
      meta: { blockGuest: true },
    },
    {
      path: '/first-run',
      name: 'first-run',
      component: () => import('../views/FirstRun.vue'),
    },
    {
      // 旧版初始化地址兼容，重定向到上游语义的 /first-run
      path: '/setup',
      redirect: '/first-run',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
    },
    {
      path: '/bot/:id',
      name: 'bot',
      component: () => import('../views/BotRedirect.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // 404 始终放行
  if (to.name === 'not-found') {
    return next();
  }

  // 首次加载时检查后端状态
  if (authStore.needsSetup === null) {
    try {
      await authStore.init();
    } catch (err) {
      console.warn('Failed to check auth status:', err);
      return next();
    }
  }

  // 未初始化 → 引导到 /first-run 创建首位管理员
  if (authStore.needsSetup) {
    return to.name === 'first-run' ? next() : next({ path: '/first-run' });
  }

  // 已初始化 → 不允许再访问 /first-run
  if (to.name === 'first-run' || to.path === '/setup') {
    return next({ path: '/' });
  }

  // 已登录用户访问 /login → 重定向首页
  if (to.path === '/login') {
    return authStore.isAuthenticated ? next({ path: '/' }) : next();
  }

  // 强制所有用户先登录
  if (!authStore.isAuthenticated) {
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }

  // 游客无法访问设置页（上游语义：游客永远不能查看/修改设置）
  if (to.meta.blockGuest && authStore.isGuest) {
    return next({ path: '/' });
  }

  // 专属链接作用域（D13）：URL 带 ?bot= 时记录锁定（App.vue 在 fetchBots 后校验）；
  // 已锁定但本次导航丢了参数 → 补回，保证站内跳转/刷新不脱离锁定
  const playerStore = usePlayerStore();
  const qBot = typeof to.query.bot === 'string' && to.query.bot ? to.query.bot : null;
  if (qBot) {
    playerStore.scopedBotId = qBot;
  } else if (playerStore.scopedBotId) {
    return next({ path: to.path, query: { ...to.query, bot: playerStore.scopedBotId }, hash: to.hash });
  }

  next();
});

export default router;
