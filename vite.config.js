import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> dist/ for Cloudflare Pages.
// `npm run build:single` -> one self-contained HTML file (dist-single/index.html).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  // Older iPhones/iPads (Safari 14+) must still run the app, so the code is translated down.
  build: {
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    cssTarget: ['safari14', 'chrome87'],
    ...(mode === 'single' ? { outDir: 'dist-single', assetsInlineLimit: 100000000 } : {}),
  },
}));
