import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.worktrees/**',
    ],
    // Windows 进程启动开销大（ffmpeg 探测类测试默认 5s 会超时）
    testTimeout: 30000,
  },
});
