import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
// npm run build        -> dist/
// npm run build:single -> dist-single/index.html (everything in ONE file)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  server: {
    port: 5173,
    open: true,
    proxy: {
      // login service (port 8001): /login-api/api/v1/auth/login -> :8001/api/v1/auth/login
      '/login-api': { target: 'http://localhost:8001', changeOrigin: true, rewrite: (p) => p.replace(/^\/login-api/, '') },
      // main backend (port 8000)
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
}));
