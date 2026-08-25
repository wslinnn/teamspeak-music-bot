export type Platform = 'netease' | 'qq' | 'bilibili' | 'youtube';

export const PLATFORM_LIST: Platform[] = ['netease', 'qq', 'bilibili', 'youtube'];

const PLATFORM_LABELS: Record<Platform, string> = {
  netease: '网易云',
  qq: 'QQ',
  bilibili: 'B站',
  youtube: 'YouTube',
};

const PLATFORM_BADGE_CLASSES: Record<Platform, string> = {
  netease: 'badge-netease',
  qq: 'badge-qq',
  bilibili: 'badge-bilibili',
  youtube: 'badge-youtube',
};

const PLATFORM_TAILWIND_CLASSES: Record<Platform, string> = {
  netease: 'bg-[rgba(232,17,35,0.15)] text-[#e81123]',
  qq: 'bg-[rgba(18,183,106,0.15)] text-[#12b76a]',
  bilibili: 'bg-[rgba(0,161,214,0.15)] text-[#00a1d6]',
  youtube: 'bg-[rgba(255,0,0,0.12)] text-[#ff0000]',
};

export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? platform;
}

export function getPlatformBadgeClass(platform: string): string {
  return PLATFORM_BADGE_CLASSES[platform as Platform] ?? '';
}

export function getPlatformTailwindClass(platform: string): string {
  return PLATFORM_TAILWIND_CLASSES[platform as Platform] ?? '';
}

// ─── 全量音源（搜索页动态标签与设置页音源管理共用，B2/D0）───────────────

/** 后端全部可管控音源的展示名（未列出的 key 原样展示） */
const PROVIDER_LABELS: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  bilibili: 'B站',
  youtube: 'YouTube',
  kugou: '酷狗',
  jellyfin: 'Jellyfin',
  local: '本地',
  spotify: 'Spotify',
};

/** 标签/设置的固定展示顺序；未列出的启用源附加在末尾 */
const PROVIDER_ORDER = ['netease', 'qq', 'bilibili', 'youtube', 'kugou', 'jellyfin', 'local', 'spotify'];

export function getProviderLabel(key: string): string {
  return PROVIDER_LABELS[key] ?? key;
}

/** 把 /api/music/providers 的 enabled 列表排成固定展示顺序 */
export function orderedProviders(enabled: string[]): string[] {
  const known = PROVIDER_ORDER.filter((p) => enabled.includes(p));
  const extra = enabled.filter((p) => !PROVIDER_ORDER.includes(p));
  return [...known, ...extra];
}

