import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // TypeScript compiles test files into dist. Test the source once, even
    // when an older build is present, rather than collecting stale copies.
    exclude: [
      ...configDefaults.exclude,
      "dist/**",
      "web/dist/**",
      "**/.claude/**",
      "**/.worktrees/**",
    ],
    // Windows 进程启动开销大（ffmpeg 探测类测试默认 5s 会超时）
    testTimeout: 30000,
  },
});
