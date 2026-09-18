import { test, expect, _electron as electron } from '@playwright/test';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('metadata display, protected body start, validation, save and title refresh in Electron', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-metadata-'));
  const userData = await mkdtemp(path.join(tmpdir(), 'desk-metadata-profile-'));
  const body = `First body paragraph.\r\n${Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.\r\n`).join('')}`;
  const source =
    `\uFEFF---\r\ntitle: "Старая 🐈"\r\ncomplex: {nested: [1, 2]}\r\n# keep comment\r\n---\r\n${body}`;
  await writeFile(path.join(root, '01.md'), source);
  await writeFile(path.join(root, '02.md'), 'Second chapter without frontmatter.\n');
  await writeFile(path.join(root, '03.md'), '---\ntitle: [\n---\nVisible malformed body.\n');
  await writeFile(path.join(root, '04.md'), '---\ntitle: Read only chapter\n---\nRead only body.\n');
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
    page.on('pageerror', (error) => console.log('PAGE', error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.book__chapter-title')).toHaveText('Старая 🐈');
    await expect(page.locator('.book__chapter-row--active .book__chapter-name')).toHaveText('Старая 🐈');
    await expect(page.locator('.cm-content')).not.toContainText('complex:');
    await expect(page.getByLabel('YAML метаданных')).toHaveCount(0);
    const metadataButton = page.getByRole('button', { name: 'Метаданные главы', exact: true });
    const scroller = page.locator('.cm-scroller');
    await scroller.evaluate(element => { element.scrollTop = 240; });
    await metadataButton.focus();
    // macOS may scroll the editor while moving focus into the title bar. The
    // metadata contract starts after its trigger owns focus: opening and
    // closing the popover must preserve that resulting reading position.
    const scrollBefore = await scroller.evaluate(element => element.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeVisible();
    await expect(page.getByLabel('YAML метаданных')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toHaveCount(0);
    await expect(metadataButton).toBeFocused();
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(scrollBefore);
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('New ');
    await expect(page.locator('.cm-content')).toContainText('New First body');
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(path.join(root, '01.review.json'), 'utf8').catch(error => {
            if (error.code === 'ENOENT') return '{"edits":[]}';
            throw error;
          })).edits.length,
      )
      .toBe(1);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.cm-content')).not.toContainText('title:');
    // Undo body deletion; metadata was protected and original source is untouched.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.cm-content')).toContainText('New First body');
    expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe(source);
    await metadataButton.click();
    const field = page.getByRole('textbox', { name: 'YAML метаданных' });
    await field.fill('title: [');
    await page.getByRole('button', { name: 'Сохранить метаданные' }).click();
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' }).getByRole('alert')).toContainText(
      'YAML',
    );
    await field.fill(
      'title: Новое название\ncomplex: {nested: [1, 2]}\n# keep comment\n',
    );
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('desk:command')!;
      const state = globalThis as unknown as { releaseMetadataSave: () => void; metadataSaveWaiting: boolean };
      state.metadataSaveWaiting = false;
      const gate = new Promise<void>(resolve => { state.releaseMetadataSave = resolve; });
      ipcMain.removeHandler('desk:command');
      ipcMain.handle('desk:command', async (event, ...args) => {
        if ((args[3] as { type?: string } | undefined)?.type === 'metadata') {
          state.metadataSaveWaiting = true;
          await gate;
        }
        return original(event, ...args);
      });
    });
    await page.getByRole('button', { name: 'Сохранить метаданные' }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { metadataSaveWaiting: boolean }).metadataSaveWaiting)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeVisible();
    await page.locator('.book__review').click();
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeVisible();
    await app.evaluate(() => (globalThis as unknown as { releaseMetadataSave: () => void }).releaseMetadataSave());
    await expect(field).toHaveCount(0);
    await expect(page.locator('.book__chapter-title')).toHaveText(
      'Новое название',
    );
    await expect(page.locator('.book__chapter-row--active .book__chapter-name')).toHaveText(
      'Новое название',
    );
    await expect(page.locator('.cm-content')).toContainText('New First body');
    const saved = await readFile(path.join(root, '01.md'), 'utf8');
    expect(saved).toBe(
      source.replace('title: "Старая 🐈"', 'title: Новое название'),
    );
    const review = JSON.parse(
      await readFile(path.join(root, '01.review.json'), 'utf8'),
    );
    expect(review.edits).toHaveLength(1);
    expect(review.edits[0].anchor.start_byte).toBeGreaterThan(0);
    await metadataButton.click();
    await field.fill('title: Cancelled');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Отбросить изменения?')).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await expect(field).toHaveValue('title: Cancelled');
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Отбросить' }).click();
    expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe(saved);
    await metadataButton.click();
    await field.fill('title: Chapter switch draft');
    await page.getByRole('button', { name: '02', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await expect(page.locator('.book__chapter-title')).toHaveText('Новое название');
    await page.getByRole('button', { name: '02', exact: true }).click();
    await page.getByRole('button', { name: 'Отбросить' }).click();
    await expect(page.locator('.cm-content')).toContainText('Second chapter without frontmatter.');
    await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
    await expect(page.getByLabel('YAML метаданных')).toHaveValue('');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Новое название', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('New First body');
    await page.screenshot({ path: '/tmp/galley-metadata-ui.png' });
    await page.getByRole('button', { name: 'Исходник', exact: true }).click();
    await expect(page.locator('.book__source')).toContainText(
      'title: Новое название',
    );
    await metadataButton.click();
    await field.fill('title: External title\ncomplex: {nested: [1, 2]}\n# keep comment\n');
    const external = saved.replace(
      'title: Новое название',
      'title: External title',
    );
    await writeFile(path.join(root, '01.md'), external);
    await expect(page.locator('.book__chapter-title')).toHaveText(
      'External title',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog', { name: 'Отбросить изменения?' })).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await field.fill('title: Stale draft');
    await page.getByRole('button', { name: 'Сохранить метаданные' }).click();
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' }).getByRole('alert')).toContainText(
      'Исходник изменился',
    );
    expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe(external);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Отбросить' }).click();
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await page.getByRole('button', { name: '[', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('Visible malformed body.');
    await expect(page.locator('.cm-content')).not.toContainText('title: [');
    const malformedTrigger = page.getByRole('button', { name: 'Метаданные главы', exact: true });
    await expect(malformedTrigger).toHaveClass(/book__metadata-trigger--invalid/);
    await malformedTrigger.click();
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' }).getByRole('alert')).toContainText('YAML');
    await page.keyboard.press('Escape');
    await writeFile(path.join(root, '04.review.json'), '{ malformed review');
    await page.getByRole('button', { name: 'Read only chapter', exact: true }).click();
    const readOnlyTrigger = page.getByRole('button', { name: 'Метаданные главы', exact: true });
    await readOnlyTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeFocused();
    await expect(page.getByLabel('YAML метаданных')).toContainText('Read only chapter');
    await expect(page.getByRole('button', { name: 'Сохранить метаданные' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Перечитать главу' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
    await page
      .getByRole('button', { name: 'Закрыть книгу', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Открыть папку…' }),
    ).toBeVisible();
  } catch (error) {
    const page = await app.firstWindow();
    console.log(await page.locator('body').innerText());
    throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
