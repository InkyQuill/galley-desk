import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchPackaged } from './packaged-app';

// Real exported Pocket result, opened in the production packaged Desk renderer.
// Legacy is a separate fixture variant; the canonical return is always tested unchanged.
for (const sidecar of ['chapter.review.json', 'chapter.md.review.json']) {
  test(`Pocket returned folder: ${sidecar}, active/unavailable records and exact apply Undo`, async () => {
    const executable = process.env.GALLEY_PACKAGED_EXECUTABLE;
    test.skip(!executable, 'Set GALLEY_PACKAGED_EXECUTABLE to the packaged executable');
    const fixture = path.resolve('docs/reviews/2026-09-16-evidence/a7-roundtrip-returned');
    const root = await mkdtemp(path.join(tmpdir(), 'galley-pocket-return-'));
    const profile = await mkdtemp(path.join(tmpdir(), 'galley-pocket-profile-'));
    const source = await readFile(path.join(fixture, 'chapter.md'));
    const review = await readFile(path.join(fixture, 'chapter.review.json'));
    const manifest = await readFile(path.join(fixture, '.pocket-editor.json'));
    await writeFile(path.join(root, 'chapter.md'), source);
    await writeFile(path.join(root, sidecar), review);
    await writeFile(path.join(root, '.pocket-editor.json'), manifest);
    expect(JSON.parse(review.toString()).chapter_note).toBe('Pocket roundtrip note 🦊');
    const book = JSON.parse(manifest.toString());
    await writeFile(path.join(profile, 'recent-books.json'), JSON.stringify([{
      path: root, bookId: book.book_id, title: book.title, lastChapterId: null, anchor: null,
      scrollTop: null, lastOpenedAt: Date.now(),
    }]));
    let session: Awaited<ReturnType<typeof launchPackaged>> | undefined;
    try {
      session = await launchPackaged(executable!, profile);
      const { page } = session;
      await page.getByRole('button', { name: 'Открыть', exact: true }).click();
      await expect(page.locator('.cm-content')).toBeVisible();
      await expect(page.locator('.book__record')).toHaveCount(6);
      await expect(page.locator('.book__record--active')).toHaveCount(3);
      await expect(page.locator('.book__record--conflicting')).toHaveCount(2);
      await expect(page.locator('.book__record--unavailable')).toHaveCount(1);
      await page.getByRole('button', { name: /^Правка: missing → stale — недоступна/ }).click();
      await expect(page.getByRole('dialog', { name: 'Недоступная запись' })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
      await page.getByRole('button', { name: 'Правка: delta → DELTA', exact: true }).click();
      await page.getByRole('button', { name: 'Применить', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();
      expect(await readFile(path.join(root, 'chapter.md'))).not.toEqual(source);
      await page.getByRole('button', { name: 'Отменить применение' }).click();
      await expect(page.getByRole('button', { name: 'Повторить применение' })).toBeEnabled();
      expect(await readFile(path.join(root, 'chapter.md'))).toEqual(source);
      expect(await readFile(path.join(root, sidecar))).toEqual(review);
      expect(await readFile(path.join(root, '.pocket-editor.json'))).toEqual(manifest);
      expect((await readdir(root)).filter(name => name.endsWith('.review.json'))).toEqual([sidecar]);
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
}
