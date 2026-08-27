/** 触感反馈：仅支持 navigator.vibrate 的环境（Android Chrome 等）生效，
 *  iOS 静默忽略。用于 seek 提交、切歌等低频关键操作的物理确认。 */
export function haptic(pattern: number | number[] = 10): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 不支持或被权限策略拒绝时静默 */
  }
}
