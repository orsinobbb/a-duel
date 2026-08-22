import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.A_DUEL_DEV_API_TARGET ?? 'http://127.0.0.1:8787';

function normalizeBasePath(value: string): string {
  return `/${value}/`.replace(/\/{2,}/g, '/');
}

export default defineConfig(({ command }) => ({
  base: command === 'build'
    ? normalizeBasePath(process.env.VITE_A_DUEL_BASE_PATH ?? '/a-duel/')
    : '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok-free.app',
      ...(process.env.A_DUEL_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean),
    ],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true },
    },
  },
}));
