import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [svelte()],
  build: {
    outDir: '../dist/frontend',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/sessions': 'http://localhost:3000',
      '/repos': 'http://localhost:3000',
      '/branches': 'http://localhost:3000',
      '/worktrees': 'http://localhost:3000',
      '/roots': 'http://localhost:3000',
      '/version': 'http://localhost:3000',
      '/update': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
