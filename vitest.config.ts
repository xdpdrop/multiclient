import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/contracts/**/*.test.ts'],
    testTimeout: 10000,
    maxWorkers: 2,
  },
});
