import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
      meta: { public: true },
    },
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
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('../views/History.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('../views/Setup.vue'),
    },
    {
      path: '/bot/:id',
      name: 'bot',
      component: () => import('../views/BotRedirect.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/Home.vue'),
    },
  ],
});

// Track whether we've checked if auth is enabled
let authCheckDone = false;
let serverAuthEnabled = false;

router.beforeEach(async (to) => {
  // Login page is always accessible
  if (to.meta.public) return true;

  const authStore = useAuthStore();

  // Check once if the server has auth enabled
  if (!authCheckDone) {
    serverAuthEnabled = await authStore.checkAuthEnabled();
    authCheckDone = true;
  }

  // If server doesn't require auth, let all routes through
  if (!serverAuthEnabled) return true;

  // Server requires auth — check if user is logged in
  if (authStore.isAuthenticated) return true;

  // Not logged in, redirect to login
  return { name: 'login', query: { redirect: to.fullPath } };
});

export default router;
