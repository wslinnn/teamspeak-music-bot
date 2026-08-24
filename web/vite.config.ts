import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // 沿用 web/public/site.webmanifest（上游资产），不由插件生成
      manifest: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // API/WS 永不落入 SPA 兜底；robots 也要真实文件
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/robots\.txt$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 专辑封面：各音乐平台 CDN，URL 稳定，二次浏览零网络请求。
            // <img> 为 no-cors 请求，需放行 opaque（status 0）响应。
            urlPattern:
              /^https?:\/\/(?:[pi]\d*\.music\.126\.net|y\.gtimg\.cn|i\d\.hdslb\.com|i\d\.hdslb\.bilibili\.com|img\.ytimg\.com)\/.*\.(?:jpg|jpeg|png|webp)(?:\?.*)?$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cover-art',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Barlow 字体（CSS + woff2）：CacheFirst，加载一次终身使用
            urlPattern: /^https?:\/\/fonts\.(?:googleapis|gstatic)\.com\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // 拆分 vendor：发版只更新业务 chunk，vendor 命中浏览器缓存
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'http-vendor': ['axios'],
        },
      },
    },
  },
});
