import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

declare global {
  interface Window {
    waitOverlayFrames?: () => Promise<void>;
    releaseOverlayFrames?: () => void;
    pendingOverlayFrames?: Array<() => void>;
  }
}

test('workspace layers preserve drafts, own Escape and remain painted inside the viewport', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-layers-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'desk-layers-profile-'));
  await writeFile(path.join(root, '01.md'), '---\ntitle: Layer test\n---\nBody for search.\n');
  for (let i = 2; i <= 24; i++) await writeFile(path.join(root, `${String(i).padStart(2, '0')}.md`), `Chapter ${i}.`);
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
  try {
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.book__chapter-menu-button').first().click();
    const menu = page.locator('.book__chapter-menu-items');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(el => [...el.querySelectorAll('button')].every(button => {
      const r = button.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }))).toBe(true);
    await page.keyboard.press('Escape');
    await page.locator('.book__chapter-menu-button').last().click();
    expect(await menu.evaluate(el => [...el.querySelectorAll('button')].every(button => { const r = button.getBoundingClientRect(); return r.bottom <= innerHeight && button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }))).toBe(true);
    expect(await page.locator('.book__chapters').evaluate(el => el.scrollLeft)).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Заметка главы', exact: true }).click();
    await page.getByLabel('Текст заметки').fill('Unsaved survives layout');
    await page.getByRole('button', { name: 'Скрыть рецензию', exact: true }).click();
    await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    await expect(page.getByLabel('Текст заметки')).toHaveValue('Unsaved survives layout');
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.locator('.book__review')).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { maxChapterNotes?: number; chapterNoteObserver?: MutationObserver };
      state.maxChapterNotes = document.querySelectorAll('.chapter-note').length;
      state.chapterNoteObserver = new MutationObserver(() => {
        state.maxChapterNotes = Math.max(state.maxChapterNotes ?? 0, document.querySelectorAll('.chapter-note').length);
      });
      state.chapterNoteObserver.observe(document.body, { childList: true, subtree: true });
    });
    await expect(page.getByLabel('Текст заметки')).toHaveValue('Unsaved survives layout');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.book__sidebar-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { maxChapterNotes?: number; chapterNoteObserver?: MutationObserver };
      state.chapterNoteObserver?.disconnect();
      return state.maxChapterNotes;
    })).toBe(1);
    await expect(page.getByLabel('Текст заметки')).toHaveValue('Unsaved survives layout');
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.locator('.book__review')).toHaveCount(0);
    // Hold the overlay's deferred focus until the user has focused the note.
    await page.evaluate(() => {
      const original = window.requestAnimationFrame.bind(window);
      const pending: Array<() => void> = [];
      window.requestAnimationFrame = callback => {
        pending.push(() => callback(performance.now()));
        return original(() => undefined);
      };
      Object.assign(window, { waitOverlayFrames: () => new Promise<void>(resolve => original(() => original(() => resolve()))), releaseOverlayFrames: () => {
        window.requestAnimationFrame = original;
        pending.splice(0).forEach(callback => callback());
      }, pendingOverlayFrames: pending });
    });
    await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    await page.evaluate(() => window.waitOverlayFrames?.());
    await page.getByLabel('Текст заметки').focus();
    await expect.poll(() => page.evaluate(() => window.pendingOverlayFrames?.length ?? 0)).toBeGreaterThan(0);
    await page.evaluate(() => window.releaseOverlayFrames?.());
    await expect(page.getByLabel('Текст заметки')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book__sidebar-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book__sidebar-overlay')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Заметка главы', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await expect(page.getByLabel('Текст заметки')).toHaveValue('Unsaved survives layout');
    await page.getByLabel('Текст заметки').press('Escape');
    await page.keyboard.press('Control+f');
    await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
    await page.getByLabel('YAML метаданных').press('Escape');
    await expect(page.locator('.book__search')).toBeVisible();
    await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
    await page.getByLabel('YAML метаданных').fill('title: Draft');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.locator('.book__search')).toBeVisible();
    await page.getByRole('button', { name: 'Отбросить', exact: true }).click();
    for (const width of [1100, 900]) {
      await page.setViewportSize({ width, height: 600 });
      await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
      expect(await page.locator('.book__metadata-popover').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8 && el.contains(document.elementFromPoint(r.left + 4, r.top + 4));
      })).toBe(true);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 700, height: 600 });
    await page.getByRole('button', { name: 'Показать оглавление', exact: true }).click();
    await page.locator('.book__chapter-menu-button').first().click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book__sidebar-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book__sidebar-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать оглавление', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить главу', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Показать оглавление', exact: true })).toBeFocused();
    await expect(page.locator('.book__search')).toBeVisible();
    await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
    await page.locator('.book__menu-diagnostics').click();
    await expect(page.locator('dialog.diagnostics')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await expect(page.locator('.book--zen')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Заметка главы', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desk:command');
      ipcMain.handle('desk:command', async () => { throw new Error('Test note save failure'); });
    });
    await page.getByRole('dialog', { name: 'Заметка главы', exact: true }).getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.chapter-note [role=alert]')).toBeVisible();
    const noteError = await page.locator('.chapter-note [role=alert]').innerText();
    // Книжный уровень того же сбоя живёт в плавающем центре уведомлений (Task 8)
    // отдельной карточкой — форма заметки остаётся локальной у своего действия.
    const workNotice = page.locator('.notice-center .notice--error').filter({ hasText: 'Test note save failure' });
    await expect(workNotice).toBeVisible();
    await page.getByRole('button', { name: 'Скрыть рецензию', exact: true }).click();
    await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    await expect(page.locator('.chapter-note [role=alert]')).toHaveText(noteError);
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.locator('.book__review')).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    await expect(page.locator('.chapter-note [role=alert]')).toHaveText(noteError);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.chapter-note [role=alert]')).toHaveText(noteError);
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await expect(page.locator('.chapter-note [role=alert]')).toHaveText(noteError);
    await expect(page.getByLabel('Текст заметки')).toHaveValue('Unsaved survives layout');
    // Уведомление не исчезает по таймеру: после панельных циклов, смен ширины
    // и Zen карточка книжного сбоя на месте — её снимет разрешение состояния.
    await expect(workNotice).toBeVisible();
    expect(await readFile(path.join(root, '01.review.json'), 'utf8').catch(() => '')).not.toContain('Unsaved survives layout');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('second Escape closes the chapter overlay after its menu restores trigger focus', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-layer-escape-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'desk-layer-escape-profile-'));
  await writeFile(path.join(root, '01.md'), '# Escape\n');
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
  try {
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 700, height: 600 });
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await page.getByRole('button', { name: 'Показать оглавление', exact: true }).click();
    await page.locator('.book__chapter-menu-button').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book__sidebar-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book__sidebar-overlay')).toHaveCount(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('large review tooltip wraps long tokens and clips multiline previews at 125 percent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desk-large-preview-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'desk-large-preview-profile-'));
  const { randomUUID } = await import('node:crypto');
  const { encodeReview, makeAnchor } = await import('../../packages/pocket-format/src/index');
  const source = Buffer.from('Body for long preview.\n');
  const id = randomUUID();
  const comment = `${'unbrokentoken'.repeat(250)}\n${'A long multiline comment.\n'.repeat(150)}`;
  await writeFile(path.join(root, '01.md'), source);
  await writeFile(path.join(root, '.pocket-editor.json'), JSON.stringify({ schema_version: 1, book_id: randomUUID(), title: 'Large preview', chapters: [{ id, path: '01.md', title: 'Preview' }], ignored_files: [] }));
  await writeFile(path.join(root, '01.review.json'), encodeReview({ schema_version: 1, chapter_id: id, source_path: '01.md', chapter_note: '', edits: [], signals: [{ id: randomUUID(), type: 'note', selected_text: 'Body', comment, anchor: makeAnchor(source, { from: 0, to: 4 }) }] }));
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
  try {
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1600, height: 900 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.25));
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    if (await page.locator('.book__review').count() === 0) await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    const record = page.locator('.book__record').first();
    await record.focus();
    const tooltip = page.locator('#gd-tooltip');
    await expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    await expect(record).not.toHaveAttribute('aria-describedby', /gd-tooltip/);
    expect(await tooltip.evaluate(el => {
      const r = el.getBoundingClientRect();
      const text = el.querySelector('.gd-tooltip__text')!;
      return r.left >= 8 && r.top >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8 && el.scrollWidth <= el.clientWidth && getComputedStyle(el).overflowY === 'hidden' && text.getBoundingClientRect().height > r.height;
    })).toBe(true);
    await record.click();
    await expect(page.getByRole('textbox', { name: 'Комментарий сигнала' })).toHaveValue(comment);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
