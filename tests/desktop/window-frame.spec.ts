import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchPackaged } from './packaged-app';

test.skip(process.platform !== 'linux', 'X11 window controls require Linux');

const run = promisify(execFile);
let app: Awaited<ReturnType<typeof launchPackaged>> | undefined;
let profile: string | undefined;

test.afterEach(async () => {
  if (app) await app.stop().catch(() => undefined);
  if (profile) await rm(profile, { recursive: true, force: true });
  app = undefined;
  profile = undefined;
});

test('packaged Linux window has custom accessible chrome and native controls work', async ({}, testInfo) => {
  profile = await mkdtemp(path.join(tmpdir(), 'desk-window-'));
  const executable = process.env.GALLEY_PACKAGED_EXECUTABLE
    ?? path.resolve('apps/desktop/out/galley-desk-linux-x64/galley-desk');
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
  await page.screenshot({ path: testInfo.outputPath('window-frame.png') });
  await page.getByRole('button', { name: 'Восстановить окно' }).click();
  await expect(page.getByRole('button', { name: 'Развернуть окно' })).toBeVisible();

  // Real X11 hit testing: dragging the free title area moves the native
  // window, while the buttons above remained clickable without starting a drag.
  const before = (await run('xdotool', ['getwindowgeometry', '--shell', windowId])).stdout;
  const beforeX = Number(before.match(/^X=(\d+)$/m)?.[1]);
  const beforeY = Number(before.match(/^Y=(\d+)$/m)?.[1]);
  await run('xdotool', ['windowactivate', '--sync', windowId]);
  await run('xdotool', [
    'mousemove', '--sync', String(beforeX + 400), String(beforeY + 22), 'mousedown', '1', 'sleep', '0.2',
    'mousemove_relative', '--sync', '20', '8', 'sleep', '0.1',
    'mousemove_relative', '--sync', '20', '8', 'sleep', '0.1',
    'mousemove_relative', '--sync', '20', '8', 'sleep', '0.1',
    'mousemove_relative', '--sync', '20', '8', 'sleep', '0.2', 'mouseup', '1',
  ]);
  const after = (await run('xdotool', ['getwindowgeometry', '--shell', windowId])).stdout;
  expect(Number(after.match(/^X=(\d+)$/m)?.[1])).toBeGreaterThan(beforeX);

  // Double-clicking the same draggable gap uses the renderer's Linux
  // maximize action, preserving the custom-frame behavior.
  await run('xdotool', ['mousemove', '--window', windowId, '400', '22', 'click', '--repeat', '2', '--delay', '100', '1']);
  await expect(page.getByRole('button', { name: 'Восстановить окно' })).toBeVisible();
});

test('compact welcome keeps every recent book reachable below the fixed title bar', async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'desk-window-recents-'));
  const recents = Array.from({ length: 30 }, (_, index) => ({
    path: `/missing/${String(index).padStart(2, '0')}/${'очень-длинный-путь-'.repeat(4)}`,
    bookId: `book-${index}`,
    title: `Книга ${String(index + 1).padStart(2, '0')}`,
    missing: true,
    lastOpenedAt: Date.now() - index,
    lastChapterId: null,
    anchor: null,
    scrollTop: null,
  }));
  await writeFile(path.join(profile, 'recent-books.json'), JSON.stringify(recents));
  const executable = process.env.GALLEY_PACKAGED_EXECUTABLE
    ?? path.resolve('apps/desktop/out/galley-desk-linux-x64/galley-desk');
  app = await launchPackaged(executable, profile);
  const page = app.page;
  const windowId = (await run('xdotool', ['search', '--onlyvisible', '--pid', String(app.pid)])).stdout.trim().split('\n')[0]!;
  await run('xdotool', ['windowsize', '--sync', windowId, '720', '520']);

  const titlebar = page.locator('.titlebar');
  const first = page.getByText('Книга 01', { exact: true });
  const last = page.getByText('Книга 30', { exact: true });
  await expect(first).toBeVisible();
  const fixedTop = (await titlebar.boundingBox())!.y;
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect((await titlebar.boundingBox())!.y).toBe(fixedTop);
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  expect((await titlebar.boundingBox())!.y).toBe(fixedTop);
});

test('open book uses one 44px title bar and keeps compact actions reachable', async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'desk-window-book-'));
  const bookRoot = path.join(profile, 'book');
  await mkdir(bookRoot);
  await writeFile(path.join(bookRoot, 'chapter.md'), '# Chapter\n\nText');
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify({
    schema_version: 1,
    book_id: '11111111-1111-4111-8111-111111111111',
    title: 'Compact book',
    chapters: [{ id: '22222222-2222-4222-8222-222222222222', path: 'chapter.md', title: 'Chapter' }],
    ignored_files: [],
  }));
  await writeFile(path.join(profile, 'recent-books.json'), JSON.stringify([{
    path: bookRoot,
    bookId: '11111111-1111-4111-8111-111111111111',
    title: 'Compact book',
    missing: false,
    lastOpenedAt: Date.now(),
    lastChapterId: null,
    anchor: null,
    scrollTop: null,
  }]));
  const executable = process.env.GALLEY_PACKAGED_EXECUTABLE
    ?? path.resolve('apps/desktop/out/galley-desk-linux-x64/galley-desk');
  app = await launchPackaged(executable, profile);
  const page = app.page;
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  const windowId = (await run('xdotool', ['search', '--onlyvisible', '--pid', String(app.pid)])).stdout.trim().split('\n')[0]!;
  await run('xdotool', ['windowsize', '--sync', windowId, '900', '700']);

  await expect(page.locator('header.titlebar')).toHaveCount(1);
  await expect(page.locator('.book__header')).toHaveCount(0);
  await expect(page.locator('header.titlebar')).toHaveCSS('height', '44px');
  await expect(page.getByRole('button', { name: 'Поиск по главе' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Меню книги' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Закрыть окно' })).toBeVisible();
  await page.getByRole('button', { name: 'Меню книги' }).click();
  await expect(page.getByRole('button', { name: 'Режим Zen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Оформление' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Диагностика' })).toBeVisible();
});
