import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { EditorView } from '@codemirror/view';
import { test, expect, _electron as electron, type Page } from '@playwright/test';

async function firstLine(page: Page, selector: string) {
  return page.evaluate(selector => {
    const container = document.querySelector<HTMLElement>(selector)!;
    const top = container.getBoundingClientRect().top;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('button')) continue;
      for (const match of node.textContent!.matchAll(/Строка \d{3}/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.top >= top && rect.top < top + container.clientHeight) return { text: match[0], top: rect.top - top, height: rect.height };
      }
    }
    throw new Error('No reading line visible');
  }, selector);
}
async function lineTop(page: Page, selector: string, text: string) {
  return page.evaluate(({ selector, text }) => {
    const container = document.querySelector<HTMLElement>(selector);
    if (container === null) return -99999;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const from = node.textContent!.indexOf(text);
      if (from < 0) continue;
      const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from + text.length);
      return range.getBoundingClientRect().top - container.getBoundingClientRect().top;
    }
    return -99999;
  }, { selector, text });
}

// Use a paragraph start as the measured anchor in mutation tests. A later
// paragraph's top may change by one wrapped line even when an earlier visible
// character is restored exactly, because the two views have different wraps.
async function alignReadingLine(page: Page, selector: string) {
  const reading = await firstLine(page, selector);
  await page.locator(selector).evaluate((element, offset) => { element.scrollTop += offset; }, reading.top);
  await expect.poll(async () => Math.abs(await lineTop(page, selector, reading.text))).toBeLessThan(1);
  return { ...reading, top: await lineTop(page, selector, reading.text) };
}

for (const edited of [false, true]) test(`reading viewport survives comparison both ways, edited=${edited}`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'galley-position-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-position-profile-'));
  const text = '---\ntitle: Чтение\n---\n\n' + Array.from({ length: 240 }, (_, i) => `Строка ${String(i).padStart(3, '0')} — кириллица 🙂 и длинный текст для переноса строки в узком окне.\n\n`).join('');
  await writeFile(path.join(root, 'Reading.md'), text);
  await writeFile(path.join(root, 'Next.md'), 'Другая глава\n');
  await writeFile(path.join(root, 'Empty.md'), '');
  let app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
  let page = await app.firstWindow();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await page.getByRole('button', { name: 'Чтение', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    const manifest = JSON.parse(await readFile(path.join(root, '.pocket-editor.json'), 'utf8')) as { chapters: Array<{ id: string; path: string }> };
    const identity = { bookId: await page.evaluate(async () => (await window.desk.recent())[0]!.bookId), chapterId: manifest.chapters.find(chapter => chapter.path === 'Reading.md')!.id };
    if (edited) {
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.insertText('Вставка до места чтения\n'.repeat(20));
    }
    // The caret stays at the beginning; only the scroll viewport moves.
    await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 5700; });
    await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(5000);
    await expect.poll(() => firstLine(page, '.cm-scroller').catch(() => null)).not.toBeNull();
    const before = await firstLine(page, '.cm-scroller');
    if (edited) {
      // All transactions and the toggle happen in one renderer turn, before
      // any IPC ACK; the reading caret is unrelated to this viewport.
      await page.evaluate(() => {
        const content = document.querySelector('.cm-content') as HTMLElement & { cmTile: { root: { view: EditorView } } };
        const view = content.cmTile.root.view;
        for (let i = 0; i < 20; i++) view.dispatch({ changes: { from: view.state.doc.length, insert: 'pending🙂' } });
        document.querySelector<HTMLButtonElement>('button[aria-label="Сравнение"]')!.click();
      });
    } else await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.locator('.book__comparison')).toBeVisible();
    await expect.poll(async () => Math.abs(await lineTop(page, '.book__comparison', before.text) - before.top)).toBeLessThanOrEqual(before.height + 4);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    if (edited) {
      // Search offsets after marker buttons must still select exact text.
      await page.keyboard.press('Control+f');
      await page.getByRole('textbox', { name: 'Поиск по главе' }).fill('Строка 050');
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Строка 050');
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      // Removing an insertion before the visible passage rebases its offset.
      const reading = await alignReadingLine(page, '.book__comparison');
      const history = await page.evaluate(async ({ bookId, chapterId }) => {
        const snapshot = await window.desk.openChapter(bookId, chapterId);
        const edit = snapshot.records.find(record => record.after.includes('Вставка до'));
        if (!edit) throw new Error(JSON.stringify(snapshot.records));
        await window.desk.command(bookId, chapterId, snapshot.revision, { type: 'remove', id: edit.id });
        return snapshot.canUndoInput;
      }, identity);
      expect(history).toBe(true);
      await expect.poll(async () => Math.abs(await lineTop(page, '.book__comparison', reading.text) - reading.top)).toBeLessThanOrEqual(reading.height + 4);
    }
    // A different layout at 125%, then scroll comparison farther down.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.25); });
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.locator('.book__comparison').evaluate(element => { element.scrollTop += 1800; });
    const returning = await firstLine(page, '.book__comparison');
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect.poll(async () => Math.abs(await lineTop(page, '.cm-scroller', returning.text) - returning.top)).toBeLessThanOrEqual(returning.height + 4);
    await expect(page.locator('.gd-search-highlight')).toHaveCount(0);
    const switchingBack = await alignReadingLine(page, '.cm-scroller');
    const lastTextScroll = await page.locator('.cm-scroller').evaluate(element => element.scrollTop);
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect.poll(async () => Math.abs(await lineTop(page, '.book__comparison', switchingBack.text) - switchingBack.top)).toBeLessThanOrEqual(switchingBack.height + 4);
    await page.locator('.book__comparison').evaluate(element => { element.scrollTop += 1000; });
    const closing = await firstLine(page, '.book__comparison');
    const comparisonScroll = await page.locator('.book__comparison').evaluate(element => element.scrollTop);
    expect(Math.abs(comparisonScroll - lastTextScroll)).toBeGreaterThan(100);
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    const recent = await page.evaluate(async () => (await window.desk.recent())[0]!);
    expect(recent.lastScrollTop).toBe(Math.round(lastTextScroll));
    expect(recent.lastAnchor).toBeGreaterThan(1000);
    if (edited) {
      await app.close();
      app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
      page = await app.firstWindow();
      await page.setViewportSize({ width: 1100, height: 800 });
    }
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    // A restart retains UTF-16 anchor, while the in-window cache also retains
    // the exact offset. Both restore the actual reading paragraph near top.
    if (edited) {
      await expect(page.locator('.cm-content')).toBeVisible();
      await expect.poll(() => page.locator('.cm-content').evaluate((content, offset) => {
        const view = (content as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
        const coords = view.coordsAtPos(offset!);
        return coords === null ? 99999 : Math.abs(coords.top - view.scrollDOM.getBoundingClientRect().top);
      }, recent.lastAnchor)).toBeLessThanOrEqual(closing.height + 4);
    } else {
      await expect.poll(async () => Math.abs(await lineTop(page, '.cm-scroller', closing.text) - closing.top)).toBeLessThanOrEqual(closing.height + 4);
    }
    if (edited) {
      const snapshot = await page.evaluate(async ({ bookId, chapterId }) => window.desk.openChapter(bookId, chapterId), identity);
      expect(snapshot.text.endsWith('pending🙂'.repeat(20))).toBe(true);
    }
    // Starting a chapter navigation invalidates a still-pending mode switch.
    await page.getByRole('button', { name: 'Next', exact: true }).evaluate((button, chapterFirst) => {
      if (chapterFirst) (button as HTMLButtonElement).click();
      document.querySelector<HTMLButtonElement>('button[aria-label="Сравнение"]')!.click();
      if (!chapterFirst) (button as HTMLButtonElement).click();
    }, edited);
    if (edited) {
      // A mode ticket may be created while chapter navigation awaits flush.
      // Closing the new chapter must never persist that old chapter offset.
      await expect(page.locator('.book__chapter-title')).toHaveText('Next');
      await page.getByRole('button', { name: 'Меню книги' }).click();
      await page.getByRole('button', { name: 'Закрыть книгу' }).click();
      await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
      const position = await page.evaluate(async () => (await window.desk.recent())[0]!);
      expect(position.lastChapterId).toBe(manifest.chapters.find(chapter => chapter.path === 'Next.md')!.id);
      expect(position.lastAnchor).toBeLessThanOrEqual('Другая глава\n'.length);
      await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    }
    await expect(page.locator('.cm-content')).toHaveText('Другая глава');
    await expect(page.locator('.cm-scroller')).toHaveJSProperty('scrollTop', 0);
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.locator('.book__comparison')).toContainText('Другая глава');
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('Другая глава');
    await page.getByRole('button', { name: 'Empty', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('');
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.locator('.book__comparison')).toBeVisible();
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await expect(page.locator('.cm-scroller')).toHaveJSProperty('scrollTop', 0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});


test('mode-switch flush rebases the reading anchor through a delayed rejection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'galley-flush-position-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-flush-profile-'));
  await writeFile(path.join(root, 'Reading.md'), Array.from({ length: 240 }, (_, i) => `Строка ${String(i).padStart(3, '0')} — длинный текст для проверки позиции чтения.\n\n`).join(''));
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
  const page = await app.firstWindow();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.cm-content').evaluate(content => {
      const view = (content as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      view.dispatch({ changes: { from: 0, insert: 'Вставленный абзац до чтения.\n'.repeat(35) } });
    });
    await expect(page.getByRole('button', { name: 'Правка', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Правка', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toBeVisible();
    await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 6200; });
    await expect.poll(() => firstLine(page, '.cm-scroller').catch(() => null)).not.toBeNull();
    const before = await alignReadingLine(page, '.cm-scroller');
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('desk:command')!;
      const state = globalThis as unknown as { rejectionHeld: boolean; releaseRejection: () => void };
      state.rejectionHeld = false;
      const gate = new Promise<void>(resolve => { state.releaseRejection = resolve; });
      ipcMain.removeHandler('desk:command');
      ipcMain.handle('desk:command', async (event, ...args) => {
        if ((args[3] as { type: string }).type === 'remove') { state.rejectionHeld = true; await gate; }
        return original(event, ...args);
      });
    });
    await page.getByRole('button', { name: 'Отклонить', exact: true }).evaluate(button => {
      // This optimistic tail is already in the captured editor document but
      // not in BookWindow's acknowledged snapshot. Rebasing from that stale
      // snapshot would incorrectly include changes on both sides of reading.
      const content = document.querySelector('.cm-content') as HTMLElement & { cmTile: { root: { view: EditorView } } };
      const view = content.cmTile.root.view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'Unacknowledged tail🙂' } });
      (button as HTMLButtonElement).click();
      document.querySelector<HTMLButtonElement>('button[aria-label="Сравнение"]')!.click();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { rejectionHeld: boolean }).rejectionHeld)).toBe(true);
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.book__comparison')).toHaveCount(0);
    await app.evaluate(() => (globalThis as unknown as { releaseRejection: () => void }).releaseRejection());
    await expect(page.locator('.book__comparison')).toBeVisible();
    await expect.poll(async () => Math.abs(await lineTop(page, '.book__comparison', before.text) - before.top)).toBeLessThanOrEqual(before.height + 4);
  } finally {
    await app.evaluate(() => (globalThis as unknown as { releaseRejection?: () => void }).releaseRejection?.()).catch(() => undefined);
    await app.close();
    await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});

test('chapter-then-mode navigation cannot persist the previous chapter viewport', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'galley-navigation-position-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-navigation-profile-'));
  await writeFile(path.join(root, 'Reading.md'), Array.from({ length: 240 }, (_, i) => `Строка ${String(i).padStart(3, '0')} — длинный текст для проверки позиции чтения.\n\n`).join(''));
  await writeFile(path.join(root, 'Next.md'), 'Короткая глава\n');
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: profile } });
  const page = await app.firstWindow();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    await page.getByRole('button', { name: 'Reading', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 6200; });
    await expect.poll(() => firstLine(page, '.cm-scroller').catch(() => null)).not.toBeNull();
    await page.getByRole('button', { name: 'Next', exact: true }).evaluate(button => {
      (button as HTMLButtonElement).click();
      document.querySelector<HTMLButtonElement>('button[aria-label="Сравнение"]')!.click();
    });
    await expect(page.locator('.book__chapter-title')).toHaveText('Next');
    await expect(page.locator('.book__comparison')).toContainText('Короткая глава');
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    const recent = await page.evaluate(async () => (await window.desk.recent())[0]!);
    expect(recent.lastAnchor).toBeLessThanOrEqual('Короткая глава\n'.length);
    expect(recent.lastScrollTop).toBe(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});
