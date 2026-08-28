import { ref } from 'vue';

const FONT_SCALE_KEY = 'lyrics.fontScale';
const ALLOWED = [0.85, 1, 1.25];

function readFontScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(FONT_SCALE_KEY) ?? '1');
    return ALLOWED.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

// 模块级单例：设置页与歌词页共享同一 ref，任一处修改实时联动
const fontScale = ref(readFontScale());

export function useLyricsFontScale() {
  function setFontScale(v: number): void {
    fontScale.value = v;
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(v));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }

  /** 循环切换三档：紧凑 → 标准 → 特大 → 紧凑（歌词页 Aa 按钮用） */
  function cycleFontScale(): void {
    const idx = ALLOWED.indexOf(fontScale.value);
    setFontScale(ALLOWED[(idx + 1) % ALLOWED.length]);
  }

  return { fontScale, setFontScale, cycleFontScale };
}
