import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '/tmp/gated-review-vite',
  resolve: {
    alias: {
      '#root': fileURLToPath(new URL('.', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
