import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { launchPackaged } from './packaged-app';

// Chromium CDP attaches only to the renderer. No Node inspector, RunAsNode,
// fuse changes, production test hooks, or replacement Electron executable.
test('packaged executable: save, restart, apply and byte-exact undo', async () => {
  const executable = process.env.GALLEY_PACKAGED_EXECUTABLE;
  test.skip(!executable, 'Set GALLEY_PACKAGED_EXECUTABLE to the real packaged executable');
  const root = await mkdtemp(path.join(tmpdir(), 'galley-artifact-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-artifact-profile-'));
  const bookId = randomUUID();
  const chapterId = randomUUID();
  const source = Buffer.from('кот спит.\r\nВторая строка 🦊\r\n');
  const sourcePath = path.join(root, 'chapter.md');
  const reviewPath = path.join(root, 'chapter.review.json');
  await writeFile(sourcePath, source);
  await writeFile(path.join(root, '.pocket-editor.json'), JSON.stringify({ schema_version: 1, book_id: bookId, title: 'Artifact acceptance', chapters: [{ id: chapterId, path: 'chapter.md', title: 'Chapter' }] }));
  await writeFile(path.join(profile, 'recent-books.json'), JSON.stringify([{ path: root, bookId, title: 'Artifact acceptance', lastChapterId: null, anchor: null, scrollTop: null, lastOpenedAt: Date.now() }]));
  let session: Awaited<ReturnType<typeof launchPackaged>> | undefined;
  const launch = async () => {
    session = await launchPackaged(executable!, profile);
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.cm-content')).toBeVisible();
    return session.page;
  };
  try {
    let page = await launch();
    expect(await page.evaluate(() => typeof (globalThis as unknown as { require?: unknown }).require)).toBe('undefined');
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('кит\nНовая строка 🦊');
    await expect(page.locator('.book__save-state')).toHaveText('Сохранено');
    await expect.poll(async () => (await readFile(reviewPath, 'utf8').catch(() => '')).includes('кит')).toBe(true);
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    const review = await readFile(reviewPath);
    expect(await readFile(sourcePath)).toEqual(source);
    await session?.stop();
    page = await launch();
    await expect(page.locator('.cm-content')).toContainText('кит');
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await page.getByRole('button', { name: 'Правка', exact: true }).first().click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();
    expect(await readFile(sourcePath)).not.toEqual(source);
    await page.getByRole('button', { name: 'Отменить применение' }).click();
    await expect(page.getByRole('button', { name: 'Повторить применение' })).toBeEnabled();
    expect(await readFile(sourcePath)).toEqual(source);
    expect(await readFile(reviewPath)).toEqual(review);
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
  } finally {
    try {
      await session?.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
    }
  }
});
