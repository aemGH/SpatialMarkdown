import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/quickjs',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/bridge/quickjs-adapter/index.ts'),
      name: 'SpatialEngineQuickJSBridge',
      formats: ['iife'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      external: ['node:module', 'canvas'],
    }
  },
  resolve: {
    alias: {
      '@chenglou/pretext': resolve(__dirname, 'src/engine/measurement/pretext-fork/layout.js'),
    },
  },
});
