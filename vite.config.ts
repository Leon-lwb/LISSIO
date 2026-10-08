import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

// Proxy target for `/api` during browser development (pnpm dev:web) — the standalone
// server started by `pnpm server`. Both desktop and browser use the standalone backend;
// desktop release builds get their endpoint from the sidecar supervisor.
const devServer = process.env.LISSIO_DEV_SERVER ?? 'http://127.0.0.1:8790';

const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  optimizeDeps: {
    entries: ['index.html'],
    // Webpage extraction is loaded through the AI panel code-split boundary.
    // Prebundle it at startup so dependency discovery cannot invalidate an
    // already-running dev session with "Outdated Optimize Dep".
    include: [
      '@mozilla/readability',
      'dompurify',
      'turndown',
      'turndown-plugin-gfm',
    ],
  },

  // The web exit cannot see Tauri's version injection, so bake the package.json version in
  // at build time (the source of the platform shim)
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    warmup: {
      clientFiles: ['./index.html', './src/main.tsx'],
    },
    proxy: {
      // Forward same-origin traffic to the standalone server; `ws: true` covers the
      // WebSocket upgrade for /api/v1/ws
      '/api': {
        target: devServer,
        changeOrigin: true,
        ws: true,
      },
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
