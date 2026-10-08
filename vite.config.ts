import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: 'client',
  publicDir: r('./public'),
  resolve: {
    alias: {
      '@shared': r('./shared'),
      '@': r('./client/src'),
    },
  },
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
