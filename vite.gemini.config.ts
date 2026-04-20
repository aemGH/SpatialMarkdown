/**
 * Vite config for the Gemini live demo.
 *
 * Usage: npx vite --config vite.gemini.config.ts
 * Or:    npm run gemini
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'examples'),

  resolve: {
    alias: {
      '@spatial/types': resolve(__dirname, 'src/types'),
      '@spatial/parser': resolve(__dirname, 'src/parser'),
      '@spatial/engine': resolve(__dirname, 'src/engine'),
      '@spatial/renderer': resolve(__dirname, 'src/renderer'),
      '@spatial/bridge': resolve(__dirname, 'src/bridge'),
    },
  },

  server: {
    port: 3001,
    open: '/gemini.html',
  },
});
