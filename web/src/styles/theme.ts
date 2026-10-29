/** 主题三态的纯函数层（fork 词汇：AUTO 跟随系统；上游 v1.15.4 语义移植）。
 *
 * main.ts 在 createApp 之前先行应用一次，消除「保存过浅色/系统浅色却在
 * 首帧渲染深色默认值」的闪屏窗口；此后 App.vue 的 watcher 继续（响应 AUTO
 * 跟随系统切换），store 的 systemPrefersDark 监听照旧并行，互不替代。
 */

export type Theme = 'dark' | 'light';
/** fork 的主题偏好三态：显式深浅或跟随系统 */
export type ThemePreference = Theme | 'auto';

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || saved === 'light' || saved === 'auto' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches,
): Theme {
  return preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference;
}

/** 应用解析后的主题到文档根：data-theme 驱动 CSS 变量，colorScheme 校正
 * 原生滚动条/表单控件，theme-color 更新手机状态栏/PWA 标题栏。 */
export function applyDocumentTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#222222' : '#ffffff');
}

/** 监听系统深浅色变化，返回取消观察函数（给使用方在卸载时清理）。 */
export function observeSystemTheme(onChange: (dark: boolean) => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
