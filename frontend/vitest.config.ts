import { defineConfig } from 'vitest/config';

// 单元测试只跑 tests/；e2e/ 下的 Playwright spec 由 playwright test 执行
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
