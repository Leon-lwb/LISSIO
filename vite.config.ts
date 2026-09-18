import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

// 浏览器开发 (pnpm dev:web) 时 `/api` 的转发目标 — 即 `pnpm server` 起的独立服务端。
// Desktop 与浏览器都走独立后端；Desktop 发布版由 sidecar supervisor 提供端点。
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
  },

  // Web 出口读不到 Tauri 的版本注入, 构建期固化 package.json 版本 (platform shim 的来源)
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
      // 同源转发到独立服务端; `ws: true` 覆盖 /api/v1/ws 的 WebSocket 升级
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
