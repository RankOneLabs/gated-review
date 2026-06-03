import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export const vitestConfig = defineConfig({
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

export default vitestConfig;
