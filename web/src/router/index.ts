import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

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
      path: '/favorites',
      name: 'favorites',
      component: () => import('../views/Favorites.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('../views/Setup.vue'),
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
  if (authStore.authEnabled === null) {
    try {
      await authStore.checkAuthEnabled();
    } catch (err) {
      console.warn('Failed to check auth status:', err);
      return next();
    }
  }

  // 需要初始化 → 引导到 /setup
  if (authStore.needsSetup) {
    return to.path === '/setup' ? next() : next({ path: '/setup' });
  }

  // 已初始化 → 不允许再访问 /setup
  if (to.path === '/setup') {
    return next({ path: '/' });
  }

  // 鉴权未开启 → 所有页面放行
  if (authStore.authEnabled === false) {
    return next();
  }

  // 已登录用户访问 /login → 重定向首页
  if (to.path === '/login') {
    return authStore.isAuthenticated ? next({ path: '/' }) : next();
  }

  // 强制所有用户先登录（除白名单外）
  if (!authStore.isAuthenticated) {
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }

  // 管理员专属页
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    return next({ path: '/' });
  }

  next();
});

export default router;
