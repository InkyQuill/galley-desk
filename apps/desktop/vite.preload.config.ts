import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Forge называет бандл по имени файла входа (для src/preload/index.ts
        // это было бы index.js); main.ts загружает соседний preload.js.
        entryFileNames: 'preload.js',
        chunkFileNames: '[name].js',
      },
    },
  },
});
