import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'tests/support/empty.ts') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    setupFiles: ['tests/support/env.ts'],
  },
});
