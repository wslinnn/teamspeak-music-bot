import { ref, computed } from 'vue';

// beforeinstallprompt 在页面加载早期就可能触发，而设置页挂载远晚于此——
// 必须模块级监听捕获，组件再读取。appinstalled 后收起入口。
const canInstall = ref(false);
let deferredPrompt: (Event & { prompt: () => void; userChoice?: Promise<unknown> }) | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as Event & { prompt: () => void; userChoice?: Promise<unknown> };
    canInstall.value = true;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    canInstall.value = false;
  });
}

/** PWA 安装引导：Chromium 系返回可用的一键安装按钮；iOS Safari 无该事件，
 *  以「分享 → 添加到主屏幕」静态指引兜底。已安装（standalone）时两者都不显示。 */
export function usePwaInstall() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const showIosHint = isIos && !isStandalone;

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      /* 用户关闭系统弹窗等情况 */
    }
    deferredPrompt = null;
    canInstall.value = false;
  }

  return { canInstall, showIosHint: computed(() => showIosHint), install };
}
