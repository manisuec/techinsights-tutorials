// vitest/vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Use V8 native coverage — faster and no extra dependency.
    coverage: {
      provider: 'v8',
      include: ['../src/**/*.js'],
    },
  },
});
