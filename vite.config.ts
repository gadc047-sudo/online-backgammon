import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is served by the Node/Express server in production (dist/public),
// and by Vite's dev server on :5173 in development, proxying realtime traffic
// to the long-lived Node process on :3001.
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
