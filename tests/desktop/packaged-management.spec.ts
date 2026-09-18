import { test, expect } from '@playwright/test';
import { launchPackaged } from './packaged-app';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

async function readCreatedFile(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

test('actual packaged executable persists book management and uses native trash', async () => {
  const executable = process.env.GALLEY_PACKAGED_EXECUTABLE;
  test.skip(
    !executable,
    'Set GALLEY_PACKAGED_EXECUTABLE to test the hardened package via renderer CDP',
  );
  await mkdir(path.join(homedir(), '.cache'), { recursive: true });
  const root = await mkdtemp(
    path.join(homedir(), '.cache', 'desk-packaged-management-test-'),
  );
  const profile = await mkdtemp(
    path.join(tmpdir(), 'desk-packaged-management-profile-'),
  );
  const bookId = randomUUID();
  const chapterId = randomUUID();
  await writeFile(path.join(root, 'a.md'), 'Packaged source.\n');
  await writeFile(
    path.join(root, '.pocket-editor.json'),
    JSON.stringify({
      schema_version: 1,
      book_id: bookId,
      title: 'Packaged fixture',
      chapters: [{ id: chapterId, path: 'a.md', title: 'First' }],
      ignored_files: [],
    }),
  );
  await writeFile(
    path.join(profile, 'recent-books.json'),
    JSON.stringify([
      {
        path: root,
        bookId,
        title: 'Packaged fixture',
        lastOpenedAt: Date.now(),
        lastChapterId: null,
        anchor: null,
        scrollTop: null,
      },
    ]),
  );
  const app = await launchPackaged(executable!, profile);
  try {
    const {page} = app;
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('New ');
    await page
      .getByRole('button', { name: 'Меню книги', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Переименовать книгу', exact: true })
      .click();
    const panel = page.getByRole('dialog', {
      name: 'Переименовать книгу',
      exact: true,
    });
    await panel
      .getByLabel('Название книги', { exact: true })
      .fill('Packaged renamed');
    await panel
      .getByRole('button', { name: 'Переименовать книгу', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          JSON.parse(
            await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
          ).title,
      )
      .toBe('Packaged renamed');
    await expect
      .poll(
        async () =>
          JSON.parse((await readCreatedFile(path.join(root, 'a.review.json'))) ?? '{"edits":[]}')
            .edits.length,
      )
      .toBe(1);
    const toc = page.getByRole('navigation', { name: 'Оглавление' });
    await toc.getByRole('button', { name: 'Добавить главу', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Новая глава' });
    await create.getByLabel('Название новой главы').fill('Created chapter');
    await create.getByLabel('Имя файла (.md)').fill('b.md');
    await create
      .getByRole('button', { name: 'Создать главу', exact: true })
      .click();
    await expect
      .poll(async () => readCreatedFile(path.join(root, 'b.md')))
      .toBe('# Created chapter\n');
    await toc.getByRole('button', { name: 'Действия главы: First' }).click();
    await page.getByRole('button', { name: 'Переместить в корзину…' }).click();
    await page.getByRole('dialog', { name: 'Переместить главу в корзину?' }).getByRole('button', { name: 'Отмена удаления' }).click();
    expect(await readFile(path.join(root, 'a.md'), 'utf8')).toBe(
      'Packaged source.\n',
    );
    await toc.getByRole('button', { name: 'Действия главы: First' }).click();
    await page.getByRole('button', { name: 'Переместить в корзину…' }).click();
    await page.getByRole('dialog', { name: 'Переместить главу в корзину?' })
      .getByRole('button', { name: 'Переместить в корзину', exact: true })
      .click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
        ).chapters.map((chapter: { path: string }) => chapter.path),
      )
      .toEqual(['b.md']);
    await expect(readFile(path.join(root, 'a.md'))).rejects.toThrow();
    await expect(
      readFile(path.join(root, 'a.review.json')),
    ).rejects.toThrow();
    await page.screenshot({ path: '/tmp/galley-packaged-management.png' });
    await page
      .getByRole('button', { name: 'Меню книги', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Закрыть книгу', exact: true })
      .click();
    await expect(page.locator('.recent-list__title')).toHaveText(
      'Packaged renamed',
    );
  } finally {
    await app.stop();
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
