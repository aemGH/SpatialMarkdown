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
        'react/index': resolve(__dirname, 'src/renderer/react/index.ts'),
        'canvas/index': resolve(__dirname, 'src/renderer/canvas/index.ts'),
        'svg/index': resolve(__dirname, 'src/renderer/svg/index.ts'),
        'bridge/index': resolve(__dirname, 'src/bridge/index.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@chenglou/pretext',
      ],
      output: {
        preserveModules: false,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
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
    },
  },
});
