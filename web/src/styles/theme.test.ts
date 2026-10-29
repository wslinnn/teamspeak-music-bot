import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDocumentTheme, observeSystemTheme, readThemePreference, resolveTheme } from './theme.js';

afterEach(() => vi.unstubAllGlobals());

describe('theme preferences（fork 三态：auto/dark/light）', () => {
  it('未保存偏好默认 auto，非法值回退 auto，显式选择原样保留', () => {
    for (const [saved, expected] of [[null, 'auto'], ['invalid', 'auto'], ['auto', 'auto'], ['dark', 'dark'], ['light', 'light']]) {
      vi.stubGlobal('localStorage', { getItem: () => saved });
      expect(readThemePreference()).toBe(expected);
    }
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readThemePreference()).toBe('auto');
  });

  it('auto 跟随系统深浅色，显式选择不受系统变化影响', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applyDocumentTheme 同步 data-theme / colorScheme / theme-color', () => {
    const style: Record<string, string> = {};
    const dataset: Record<string, string> = {};
    const meta = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } };
    vi.stubGlobal('document', {
      documentElement: { dataset, style },
      querySelector: () => meta,
    });
    applyDocumentTheme('light');
    expect(dataset.theme).toBe('light');
    expect(style.colorScheme).toBe('light');
    expect(meta.attrs.content).toBe('#ffffff');
    applyDocumentTheme('dark');
    expect(dataset.theme).toBe('dark');
    expect(style.colorScheme).toBe('dark');
    expect(meta.attrs.content).toBe('#222222');
  });

  it('接收系统深浅色实时变化，清理后停止监听', () => {
    const media = new EventTarget();
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('window', { matchMedia });
    const onChange = vi.fn();
    const stop = observeSystemTheme(onChange);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    media.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    media.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    stop();
    media.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
