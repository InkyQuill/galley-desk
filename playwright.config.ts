import { defineConfig } from '@playwright/test';

// Реальные Electron-тесты: сначала `npm run package` собирает Forge .vite/build entry,
// затем `npm run test:desktop` запускает оболочку через electron.launch.
export default defineConfig({
  testDir: 'tests/desktop',
  // AGENTS.md «Mandatory GUI test isolation»: refuse to run any GUI test
  // outside an isolated Xvfb virtual display, before anything can launch.
  globalSetup: './tests/desktop/gui-isolation.ts',
  // Native Electron windows share keyboard focus, including under Xvfb.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
});
