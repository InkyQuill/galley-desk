import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

test('book management: rename, create, discover, cancel trash, remove/readd review and trash pair', async () => {
  const cache = path.join(homedir(), '.cache');
  await mkdir(cache, { recursive: true });
  // /tmp is an internal tmpfs mount where gio deliberately refuses trash.
  const root = await mkdtemp(path.join(cache, 'desk-manage-book-test-'));
  const userData = await mkdtemp(path.join(tmpdir(), 'desk-manage-profile-'));
  await writeFile(path.join(root, 'a.md'), 'Alpha body.\n');
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  try {
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1100, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    const initialManifest = JSON.parse(
      await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
    );
    await page.evaluate(
      async ({ bookId, chapterId }) => {
        const snap = await window.desk.openChapter(bookId, chapterId);
        await window.desk.command(bookId, chapterId, snap.revision, {
          type: 'signal',
          from: 0,
          to: 5,
          signalType: 'note',
          comment: 'Keep this signal',
        });
      },
      {
        bookId: initialManifest.book_id,
        chapterId: initialManifest.chapters[0].id,
      },
    );
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.type('New ');
    // Open management immediately after input; pending save must drain before removal.
    const open = async () => {
      await page
        .getByRole('button', { name: 'Меню книги', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Управление книгой', exact: true })
        .click();
    };
    await open();
    const panel = page.getByRole('dialog', {
      name: 'Управление книгой',
      exact: true,
    });
    await panel
      .getByLabel('Название книги', { exact: true })
      .fill('Renamed book');
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
      .toBe('Renamed book');
    await expect(page.locator('.book__title')).toHaveText('Renamed book');
    await expect(page.locator('.titlebar__title')).toHaveText('Renamed book');
    const review = await readFile(path.join(root, 'a.review.json'), 'utf8');
    const originalId = JSON.parse(review).chapter_id;
    expect(JSON.parse(review).signals).toHaveLength(1);
    expect(JSON.parse(review).edits).toHaveLength(1);
    await panel
      .getByRole('button', { name: 'Убрать главу из книги', exact: true })
      .click();
    await expect(panel.getByLabel('a.md', { exact: true })).toBeVisible();
    expect(await readFile(path.join(root, 'a.review.json'), 'utf8')).toBe(
      review,
    );
    await panel.getByLabel('a.md', { exact: true }).check();
    await panel
      .getByRole('button', { name: 'Добавить выбранные главы', exact: true })
      .click();
    await expect(panel.getByLabel('a.md', { exact: true })).toHaveCount(0);
    expect(
      JSON.parse(await readFile(path.join(root, '.pocket-editor.json'), 'utf8'))
        .chapters[0].id,
    ).toBe(originalId);
    await panel
      .getByRole('button', { name: 'Закрыть управление книгой' })
      .click();
    await expect(page.locator('.cm-content')).toContainText('New Alpha body.');
    await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
    await page
      .getByRole('button', { name: 'Закрыть книгу', exact: true })
      .click();
    await page
      .locator('.recent-list__item')
      .filter({ hasText: 'Renamed book' })
      .getByRole('button', { name: 'Открыть', exact: true })
      .click();
    await expect(page.locator('.cm-content')).toContainText('New Alpha body.');
    expect(await readFile(path.join(root, 'a.review.json'), 'utf8')).toBe(
      review,
    );
    await open();
    await panel.getByLabel('Название новой главы').fill('Second');
    await panel.getByLabel('Имя файла (.md)').fill('b.md');
    await panel
      .getByRole('button', { name: 'Создать главу', exact: true })
      .click();
    await expect
      .poll(async () => readFile(path.join(root, 'b.md'), 'utf8'))
      .toBe('# Second\n');
    await writeFile(path.join(root, 'extra.md'), '# External extra\n');
    await panel.getByRole('button', { name: 'Обновить список файлов' }).click();
    await panel.getByLabel('extra.md', { exact: true }).check();
    await panel
      .getByRole('button', { name: 'Добавить выбранные главы' })
      .click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
        ).chapters.map((c: { path: string }) => c.path),
      )
      .toEqual(['a.md', 'b.md', 'extra.md']);
    await panel.getByRole('button', { name: 'Удалить файлы главы…' }).click();
    await expect(panel.getByRole('alertdialog')).toContainText(
      'связанный файл рецензии',
    );
    await panel.getByRole('button', { name: 'Отмена удаления' }).click();
    expect(await readFile(path.join(root, 'a.review.json'), 'utf8')).toBe(
      review,
    );
    expect(await readFile(path.join(root, 'a.md'), 'utf8')).toBe(
      'Alpha body.\n',
    );
    await app.evaluate(({ shell }) => {
      (
        globalThis as unknown as { originalTrash: typeof shell.trashItem }
      ).originalTrash = shell.trashItem;
      shell.trashItem = async () => {
        throw new Error('injected trash failure');
      };
    });
    await panel.getByRole('button', { name: 'Удалить файлы главы…' }).click();
    await panel
      .getByRole('button', { name: 'Переместить в корзину', exact: true })
      .click();
    await expect(panel.getByRole('alert')).toContainText(
      'Остались: a.md, a.review.json',
    );
    expect(
      JSON.parse(await readFile(path.join(root, '.pocket-editor.json'), 'utf8'))
        .chapters,
    ).toHaveLength(3);
    await app.evaluate(({ shell }) => {
      shell.trashItem = (
        globalThis as unknown as { originalTrash: typeof shell.trashItem }
      ).originalTrash;
    });
    await panel
      .getByRole('button', { name: 'Переместить в корзину', exact: true })
      .click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
        ).chapters.map((c: { path: string }) => c.path),
      )
      .toEqual(['b.md', 'extra.md']);
    await expect(readFile(path.join(root, 'a.md'))).rejects.toThrow();
    await expect(readFile(path.join(root, 'a.review.json'))).rejects.toThrow();
    const remaining = JSON.parse(
      await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
    );
    const missingId = remaining.chapters.find(
      (chapter: { path: string }) => chapter.path === 'extra.md',
    ).id;
    await rm(path.join(root, 'extra.md'));
    await panel.getByRole('button', { name: 'Обновить список файлов' }).click();
    await panel.getByLabel('Глава для управления').selectOption(missingId);
    await expect(
      panel.getByRole('region', { name: 'Текущая глава' }),
    ).toContainText('файл отсутствует');
    await panel
      .getByRole('button', { name: 'Убрать главу из книги', exact: true })
      .click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
        ).chapters.map((chapter: { path: string }) => chapter.path),
      )
      .toEqual(['b.md']);
    await page.setViewportSize({ width: 620, height: 700 });
    await page.screenshot({ path: '/tmp/galley-management-compact.png' });
    await panel
      .getByRole('button', { name: 'Закрыть управление книгой' })
      .click();
    await expect(page.locator('.book__chapter-title')).toHaveText('Second');
    await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
    await page
      .getByRole('button', { name: 'Закрыть книгу', exact: true })
      .click();
    await expect(page.locator('.recent-list__title')).toHaveText(
      'Renamed book',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

for (const failure of ['trash', 'manifest-conflict'] as const) {
  test(`failed management ${failure} keeps typing and undo on the mounted editor`, async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), 'desk-management-rejected-'),
    );
    const profile = await mkdtemp(
      path.join(tmpdir(), 'desk-management-rejected-profile-'),
    );
    await writeFile(path.join(root, 'a.md'), 'Alpha body\n');
    const app = await electron.launch({
      args: ['apps/desktop'],
      env: { ...process.env, GALLEY_DESK_USER_DATA: profile },
    });
    try {
      await app.evaluate(({ dialog, shell }, root) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [root],
        });
        shell.trashItem = async () => {
          throw Error('injected failure');
        };
      }, root);
      const page = await app.firstWindow();
      await page.getByRole('button', { name: 'Открыть папку…' }).click();
      await expect(page.locator('.cm-content')).toBeVisible();
      const manifestPath = path.join(root, '.pocket-editor.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const ids = {
        bookId: manifest.book_id,
        chapterId: manifest.chapters[0].id,
      };
      await page.evaluate(async ({ bookId, chapterId }) => {
        let snapshot = await window.desk.openChapter(bookId, chapterId);
        for (let index = 0; index < 4; index++)
          snapshot = await window.desk.command(
            bookId,
            chapterId,
            snapshot.revision,
            {
              type: 'text',
              changes: [{ from: 0, to: 0, insert: 'x' }],
              selection: { anchor: 1, head: 1 },
            },
          );
      }, ids);
      await expect(page.locator('.cm-content')).toContainText('xxxxAlpha body');
      await page
        .getByRole('button', { name: 'Меню книги', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Управление книгой', exact: true })
        .click();
      const panel = page.getByRole('dialog', {
        name: 'Управление книгой',
        exact: true,
      });
      if (failure === 'trash') {
        await panel
          .getByRole('button', { name: 'Удалить файлы главы…' })
          .click();
        await panel
          .getByRole('button', { name: 'Переместить в корзину', exact: true })
          .click();
        await expect(panel.getByRole('alert')).toContainText('Остались:');
      } else {
        await writeFile(
          manifestPath,
          JSON.stringify({ ...manifest, title: 'External' }),
        );
        await panel
          .getByRole('button', { name: 'Убрать главу из книги', exact: true })
          .click();
        await expect(panel.getByRole('alert')).toContainText('Манифест');
      }
      await panel
        .getByRole('button', { name: 'Закрыть управление книгой' })
        .click();
      await page.locator('.cm-content').click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
      await page.keyboard.type('y');
      await expect
        .poll(() =>
          page.evaluate(
            async (ids) =>
              (await window.desk.openChapter(ids.bookId, ids.chapterId)).text,
            ids,
          ),
        )
        .toBe('yxxxxAlpha body\n');
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(() =>
          page.evaluate(
            async (ids) =>
              (await window.desk.openChapter(ids.bookId, ids.chapterId)).text,
            ids,
          ),
        )
        .toBe('xxxxAlpha body\n');
      await expect(page.locator('.cm-content')).toHaveText('xxxxAlpha body');
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(() =>
          page.evaluate(
            async (ids) =>
              (await window.desk.openChapter(ids.bookId, ids.chapterId)).text,
            ids,
          ),
        )
        .toBe('xxxAlpha body\n');
      await expect(page.locator('.cm-content')).toHaveText('xxxAlpha body');
    } finally {
      // These failure regressions may leave old builds unable to flush/close.
      await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
      await app.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
    }
  });
}
