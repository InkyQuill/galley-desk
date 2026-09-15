import { defineConfig } from '@playwright/test';

// Реальные Electron-тесты: сначала `npm run package` собирает Forge .vite/build entry,
// затем `npm run test:desktop` запускает оболочку через electron.launch.
export default defineConfig({
  testDir: 'tests/desktop',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
});
