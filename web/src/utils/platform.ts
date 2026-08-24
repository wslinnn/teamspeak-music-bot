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
