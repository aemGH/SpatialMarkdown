/**
 * Vite config for the Showcase stress-test demo.
 *
 * Usage: npx vite --config vite.showcase.config.ts
 * Or:    npm run showcase
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
    port: 3002,
    open: '/showcase.html',
  },
});
