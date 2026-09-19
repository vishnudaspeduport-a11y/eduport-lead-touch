import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the Vite server proxies /api to `wrangler dev` (port 8787).
// Prod: the Worker serves dist/ itself, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'], table: ['@tanstack/react-table', '@tanstack/react-query'] },
      },
    },
  },
});
