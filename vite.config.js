import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), staff: resolve(import.meta.dirname, 'team-mk7q.html') },
      output: { manualChunks: { three: ['three'], physics: ['cannon-es'] } }
    }
  },
  server: { host: true }
});
