import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    // Send build output specifically to dist/android
    outDir: 'dist/android',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/bridge/android-adapter/index.ts'),
      // Name required by Vite when outputting an IIFE
      name: 'SpatialEngineAndroidBridge',
      formats: ['iife'],
      // Keep output file naming predictable for the Android asset loader
      fileName: () => 'index.js'
    },
    // We don't want external dependencies; the bridge should be entirely self-contained
    rollupOptions: {
      external: []
    }
  }
});
