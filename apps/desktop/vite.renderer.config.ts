import { defineConfig } from 'vite';

// https://vitejs.dev/config
// JSX обрабатывается встроенным esbuild-преобразованием Vite (jsx: react-jsx
// из tsconfig.json), поэтому отдельный плагин React не нужен: в dev-режиме
// нет inline-скриптов, и CSP `script-src 'self'` соблюдается.
export default defineConfig({});
