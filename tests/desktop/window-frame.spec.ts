import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchPackaged } from './packaged-app';

const run = promisify(execFile);
let app: Awaited<ReturnType<typeof launchPackaged>> | undefined;
let profile: string | undefined;

test.afterEach(async () => {
  if (app) await app.stop().catch(() => undefined);
  if (profile) await rm(profile, { recursive: true, force: true });
  app = undefined;
  profile = undefined;
});

test('packaged Linux window has custom accessible chrome and native controls work', async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'desk-window-'));
  const executable = process.env.GALLEY_PACKAGED_EXECUTABLE
    ?? path.resolve('apps/desktop/out/Galley Desk-linux-x64/Galley Desk');
  app = await launchPackaged(executable, profile);
  const page = app.page;
  await expect(page.getByRole('img', { name: 'Galley Desk' })).toBeVisible();
  const minimize = page.getByRole('button', { name: 'Свернуть окно' });
  await expect(minimize).toBeVisible();
  const windowId = (await run('xdotool', ['search', '--onlyvisible', '--pid', String(app.pid)])).stdout.trim().split('\n')[0]!;
  await minimize.evaluate(button => button.click());
  await expect.poll(async () => (await run('xprop', ['-id', windowId, '_NET_WM_STATE'])).stdout).toContain('_NET_WM_STATE_HIDDEN');
  await run('xdotool', ['windowmap', '--sync', windowId]);
  const maximize = page.getByRole('button', { name: 'Развернуть окно' });
  await maximize.click();
  await expect(page.getByRole('button', { name: 'Восстановить окно' })).toBeVisible();
  await page.screenshot({ path: '.superpowers/sdd/2026-09-16-real-book-fixes/task-6-window-frame.png' });
  await page.getByRole('button', { name: 'Восстановить окно' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть окно' })).toBeVisible();
});
