import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          runtime: resolve('src/runtime/index.ts'),
          'claude-bridge': resolve('src/bridges/claude-permissions/index.ts'),
          'workspace-tools': resolve('src/bridges/workspace-tools/index.ts'),
          'storage-test': resolve('tests/integration/storage.ts'),
          'history-test': resolve('tests/integration/history.ts'),
          'features-test': resolve('tests/integration/features.ts'),
          'comparison-test': resolve('tests/integration/comparison.ts'),
          'artifacts-test': resolve('tests/integration/artifacts.ts'),
          'research-worker': resolve('src/runtime/research/parser-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: { plugins: [react()] },
});
