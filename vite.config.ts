import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

// `BUILD_TARGET=player vite build` produces the standalone game player into dist-player/.
const isPlayer = process.env.BUILD_TARGET === 'player';

/** Emit the player entry as index.html so an exported game opens by default. */
function renamePlayerEntry(): Plugin {
  return {
    name: 'rename-player-entry',
    closeBundle() {
      const from = resolve(__dirname, 'dist-player/player.html');
      const to = resolve(__dirname, 'dist-player/index.html');
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

// Tauri expects a fixed dev server port (see src-tauri/tauri.conf.json devUrl).
export default defineConfig({
  plugins: [react(), ...(isPlayer ? [renamePlayerEntry()] : [])],
  clearScreen: false,
  // Relative base so the exported player runs from any folder (or file://).
  ...(isPlayer ? { base: './' } : {}),
  // ktx2-encoder's Basis wasm loader (dist/basis/basis_encoder.js) contains a top-level `await`
  // inside a NODE-only guard (`if (ENVIRONMENT_IS_NODE) { await import('module') }`). esbuild's
  // dep pre-bundler rejects that statically under Vite's default es2020 target. Bump the per-file
  // transform target AND tell the dep optimizer's esbuild to accept top-level await (Vite merges
  // `optimizeDeps.esbuildOptions.supported` into its own defaults — see runOptimizeDeps).
  esbuild: { target: 'es2022' },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
      supported: { 'top-level-await': true },
    },
  },
  build: isPlayer
    ? {
        target: 'es2022',
        outDir: 'dist-player',
        emptyOutDir: true,
        rollupOptions: { input: resolve(__dirname, 'player.html') },
      }
    : { target: 'es2022' },
  server: {
    host: '0.0.0.0',
    // 17420, not Tauri's default 1420 — that collides with any other Tauri app's dev server (and the
    // sibling MomentumCup/MyAge projects). Keep this in sync with src-tauri/tauri.conf.json devUrl.
    port: 17420,
    strictPort: true,
  },
});
