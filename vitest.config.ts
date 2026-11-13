import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
