import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],

  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'canvas/index': resolve(__dirname, 'src/renderer/canvas/index.ts'),
        'bridge/index': resolve(__dirname, 'src/bridge/index.ts'),
        'ssr/index': resolve(__dirname, 'src/ssr/index.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [
        'canvas',
        'node:module',
        // NOTE: @chenglou/pretext is NOT external — we ship our fork inline.
        // See src/engine/measurement/pretext-fork/README.md
      ],
      output: {
        preserveModules: false,
      },
    },
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
  },

  resolve: {
    alias: {
      '@spatial/types': resolve(__dirname, 'src/types'),
      '@spatial/parser': resolve(__dirname, 'src/parser'),
      '@spatial/engine': resolve(__dirname, 'src/engine'),
      '@spatial/renderer': resolve(__dirname, 'src/renderer'),
      '@spatial/bridge': resolve(__dirname, 'src/bridge'),
      // Fork of @chenglou/pretext with injectable MeasurementContext.
      // See src/engine/measurement/pretext-fork/README.md
      '@chenglou/pretext': resolve(__dirname, 'src/engine/measurement/pretext-fork/layout.js'),
    },
  },
});
