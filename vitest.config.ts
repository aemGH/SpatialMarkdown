import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/golden/**/*.test.ts',
    ],

    benchmark: {
      include: ['tests/benchmarks/**/*.bench.ts'],
      reporters: ['verbose'],
      outputFile: 'tests/benchmarks/results.json',
    },

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/**/index.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },

    environment: 'jsdom',
    globals: true,

    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },

  resolve: {
    alias: {
      '@spatial/types': resolve(__dirname, 'src/types'),
      '@spatial/parser': resolve(__dirname, 'src/parser'),
      '@spatial/engine': resolve(__dirname, 'src/engine'),
      '@spatial/renderer': resolve(__dirname, 'src/renderer'),
      '@spatial/bridge': resolve(__dirname, 'src/bridge'),
      '@chenglou/pretext': resolve(__dirname, 'src/engine/measurement/pretext-fork/layout.js'),
    },
  },
});
