import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setupIsolatedEnv.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
