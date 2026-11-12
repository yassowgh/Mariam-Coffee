import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Public website (mariamcoffeeshop.com/). Built first into dist/; the management app
// is then built into dist/management/ by the root vite.config.js.
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: '/',
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, '../dist'),
    emptyOutDir: true,
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    cssTarget: ['safari14', 'chrome87'],
    rolldownOptions: {
      input: { index: resolve(import.meta.dirname, 'index.html'), notfound: resolve(import.meta.dirname, '404.html') },
    },
  },
});
