import { defineConfig } from 'vite';

// https://vitejs.dev/config
// JSX обрабатывается встроенным JSX-преобразованием Vite (jsx: react-jsx
// из tsconfig.json), поэтому отдельный плагин React не нужен: в dev-режиме
// нет inline-скриптов, и CSP `script-src 'self'` соблюдается.
export default defineConfig({
  // Explicit IPv4 loopback avoids an IPv6-only localhost listener on Linux
  // hosts where ::1 traffic is filtered. Keep the dev server local.
  server: { host: '127.0.0.1' },
});
