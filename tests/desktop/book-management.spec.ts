import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

test('chapter sorting previews the whole spine and preserves the active edit session', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-reorder-book-'));
  const userData = await mkdtemp(path.join(tmpdir(), 'desk-reorder-profile-'));
  await writeFile(path.join(root, '10.md'), '# Ten\nBody ten\n');
  await writeFile(path.join(root, '2.md'), '# Two\nBody two\n');
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: userData } });
  try {
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    const manifestPath = path.join(root, '.pocket-editor.json');
    const initial = JSON.parse(await readFile(manifestPath, 'utf8'));
    const activePath = initial.chapters[0].path as string;
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.type('Draft ');
    await expect.poll(async () => readFile(path.join(root, activePath.replace(/\.md$/, '.review.json')), 'utf8').catch(() => '')).toContain('Draft ');
    const sourceBefore = await readFile(path.join(root, activePath));
    const reviewBefore = await readFile(path.join(root, activePath.replace(/\.md$/, '.review.json')));
    const toc = page.getByRole('navigation', { name: 'Оглавление' });
    await toc.getByLabel('Фильтр глав').fill('2');
    await toc.getByRole('button', { name: 'Сортировать главы' }).click();
    const sort = page.getByRole('dialog', { name: 'Сортировать главы' });
    await expect(sort).toContainText('Сортируется вся книга, включая главы, скрытые фильтром.');
    await expect(sort.getByRole('listitem')).toHaveCount(2);
    await sort.getByRole('button', { name: 'Отмена' }).click();
    expect(await readFile(manifestPath, 'utf8')).toBe(JSON.stringify(initial, null, 2) + '\n');
    await toc.getByRole('button', { name: 'Сортировать главы' }).click();
    await page.getByRole('dialog', { name: 'Сортировать главы' }).getByRole('button', { name: 'Применить' }).click();
    await expect.poll(async () => JSON.parse(await readFile(manifestPath, 'utf8')).chapters.map((chapter: {path:string}) => chapter.path)).toEqual(['2.md', '10.md']);
    expect(await readFile(path.join(root, activePath))).toEqual(sourceBefore);
    expect(await readFile(path.join(root, activePath.replace(/\.md$/, '.review.json')))).toEqual(reviewBefore);
    await expect(page.locator('.book__chapter-title')).toContainText(activePath === '10.md' ? 'Ten' : 'Two');
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('.cm-content')).not.toContainText('Draft ');
    await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
    await page.getByRole('button', { name: 'Закрыть книгу', exact: true }).click();
    await page.locator('.recent-list__item').getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(manifestPath, 'utf8')).chapters.map((chapter: {path:string}) => chapter.path)).toEqual(['2.md', '10.md']);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

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
    // Open rename immediately after input; pending save must drain before management.
    const openRename = async () => {
      await page
        .getByRole('button', { name: 'Меню книги', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Переименовать книгу', exact: true })
        .click();
    };
    await openRename();
    const panel = page.getByRole('dialog', {
      name: 'Переименовать книгу',
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
    await expect(panel).toHaveCount(0);
    const toc = page.getByRole('navigation', { name: 'Оглавление' });
    await toc.getByRole('button', { name: 'Действия главы: a' }).click();
    await page.getByRole('button', { name: 'Убрать из оглавления', exact: true }).click();
    await expect(toc.getByText('a.md', { exact: true })).toHaveCount(0);
    expect(await readFile(path.join(root, 'a.review.json'), 'utf8')).toBe(
      review,
    );
    await toc.getByRole('button', { name: 'Найти главы в папке', exact: true }).click();
    const discovery = page.getByRole('dialog', { name: 'Найти главы в папке' });
    await discovery.getByLabel('a.md', { exact: true }).check();
    await discovery
      .getByRole('button', { name: 'Добавить выбранные главы', exact: true })
      .click();
    await expect(discovery).toHaveCount(0);
    expect(
      JSON.parse(await readFile(path.join(root, '.pocket-editor.json'), 'utf8'))
        .chapters[0].id,
    ).toBe(originalId);
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
    const tocAfterReopen = page.getByRole('navigation', { name: 'Оглавление' });
    // Delay the actual exclusive creation so the first read necessarily sees ENOENT.
    await app.evaluate(async ({}, target) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      const originalOpen = fs.open;
      fs.open = async (...args) => {
        if (args[0] === target) {
          fs.open = originalOpen;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        return originalOpen(...args);
      };
    }, path.join(root, 'b.md'));
    await tocAfterReopen.getByRole('button', { name: 'Добавить главу', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Новая глава' });
    await create.getByLabel('Название новой главы').fill('Second');
    await create.getByLabel('Имя файла (.md)').fill('b.md');
    await create
      .getByRole('button', { name: 'Создать главу', exact: true })
      .click();
    await expect
      .poll(async () => readFile(path.join(root, 'b.md'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }))
      .toBe('# Second\n');
    await writeFile(path.join(root, 'extra.md'), '# External extra\n');
    await tocAfterReopen.getByRole('button', { name: 'Найти главы в папке', exact: true }).click();
    const discoveryAgain = page.getByRole('dialog', { name: 'Найти главы в папке' });
    await discoveryAgain.getByRole('button', { name: 'Обновить список файлов' }).click();
    await discoveryAgain.getByLabel('extra.md', { exact: true }).check();
    await discoveryAgain
      .getByRole('button', { name: 'Добавить выбранные главы' })
      .click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
        ).chapters.map((c: { path: string }) => c.path),
      )
      .toEqual(['a.md', 'b.md', 'extra.md']);
    // The menu belongs to the non-active a.md row and must not switch chapters.
    await tocAfterReopen.getByRole('button', { name: 'Действия главы: a' }).click();
    await page.getByRole('button', { name: 'Переместить в корзину…' }).click();
    const trash = page.getByRole('dialog', { name: 'Переместить главу в корзину?' });
    await expect(trash).toContainText(
      'связанный файл рецензии',
    );
    await trash.getByRole('button', { name: 'Отмена удаления' }).click();
    await expect(
      tocAfterReopen.getByRole('button', { name: 'Действия главы: a' }),
    ).toBeFocused();
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
    await tocAfterReopen.getByRole('button', { name: 'Действия главы: a' }).click();
    await page.getByRole('button', { name: 'Переместить в корзину…' }).click();
    await page.getByRole('dialog', { name: 'Переместить главу в корзину?' })
      .getByRole('button', { name: 'Переместить в корзину', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Переместить главу в корзину?' }).getByRole('alert')).toContainText(
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
    await page.getByRole('dialog', { name: 'Переместить главу в корзину?' })
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
    await rm(path.join(root, 'extra.md'));
    await tocAfterReopen.getByRole('button', { name: 'Найти главы в папке', exact: true }).click();
    await page.getByRole('dialog', { name: 'Найти главы в папке' }).getByRole('button', { name: 'Обновить список файлов' }).click();
    await page.getByRole('dialog', { name: 'Найти главы в папке' }).getByRole('button', { name: 'Закрыть' }).click();
    await expect(tocAfterReopen.getByText('файл отсутствует')).toBeVisible();
    await tocAfterReopen.getByRole('button', { name: 'Действия главы: External extra' }).click();
    await page.getByRole('button', { name: 'Убрать из оглавления', exact: true }).click();
    await expect
      .poll(async () =>
        JSON.parse(
          await readFile(path.join(root, '.pocket-editor.json'), 'utf8'),
        ).chapters.map((chapter: { path: string }) => chapter.path),
      )
      .toEqual(['b.md']);
    await page.setViewportSize({ width: 620, height: 700 });
    await page.screenshot({ path: '/tmp/galley-management-compact.png' });
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
    // A failed assertion may leave management mid-flight; don't let the quit
    // guard hide its error behind the entire test timeout. UI close is tested above.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
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
      const toc = page.getByRole('navigation', { name: 'Оглавление' });
      await toc.getByRole('button', { name: 'Действия главы: a' }).click();
      if (failure === 'trash') {
        await page.getByRole('button', { name: 'Переместить в корзину…' }).click();
        const panel = page.getByRole('dialog', { name: 'Переместить главу в корзину?' });
        await panel
          .getByRole('button', { name: 'Переместить в корзину', exact: true })
          .click();
        await expect(panel.getByRole('alert')).toContainText('Остались:');
        await panel.getByRole('button', { name: 'Закрыть' }).click();
      } else {
        await writeFile(
          manifestPath,
          JSON.stringify({ ...manifest, title: 'External' }),
        );
        await page.getByRole('button', { name: 'Убрать из оглавления', exact: true }).click();
        const panel = page.getByRole('dialog', { name: 'Убрать главу из оглавления?' });
        await expect(panel.getByRole('alert')).toContainText('Манифест');
        await panel.getByRole('button', { name: 'Закрыть' }).click();
      }
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
