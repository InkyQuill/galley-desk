import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('launches without node access in renderer', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-shell-test-'));
  const app = await electron.launch({args:['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile }});
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Galley Desk'})).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});

test('blocks navigation away from the app origin', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-shell-test-'));
  const app = await electron.launch({args:['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile }});
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Galley Desk'})).toBeVisible();
    // Строка начинается с `http://localhost:5173` (префиксная проверка пропустила бы),
    // но origin URL — http://127.0.0.1:1.
    await page.evaluate(() => { window.location.href = 'http://localhost:5173@127.0.0.1:1/'; });
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('127.0.0.1');
    expect(page.url()).toContain('index.html');
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
});
