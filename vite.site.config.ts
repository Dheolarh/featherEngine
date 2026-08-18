import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dedicated public-website build. Keeping this separate from the editor prevents
 * the marketing bundle from copying the editor's large starter assets or
 * booting any project-store, extension-host, Tauri, or MCP side effects.
 */
export default defineConfig({
  root: 'site',
  plugins: [react()],
  publicDir: 'public',
  build: {
    target: 'es2020',
    outDir: '../dist-site',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 17421,
    strictPort: true,
  },
});
