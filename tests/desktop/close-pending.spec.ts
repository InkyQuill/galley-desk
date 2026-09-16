import type { IpcMainInvokeEvent } from 'electron';
import type { EditorView } from '@codemirror/view';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const roots: string[] = [];
async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
test.afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function launch() {
  const bookRoot = await temp('desk-close-book-');
  const userData = await temp('desk-close-profile-');
  await writeFile(path.join(bookRoot, '01.md'), 'cat');
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: userData } });
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(page.locator('.cm-content')).toHaveText('cat');
  return { app, page, bookRoot, userData };
}
async function forceStop(app: ElectronApplication) {
  // A failed-close scenario intentionally cannot use graceful app.close().
  let child;
  try { child = app.process(); } catch { return; }
  const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await exited;
}

async function burst(page: Page, char: string, closeBook = false): Promise<void> {
  await page.evaluate(({ char, closeBook }) => {
    // The same view lookup used by EditorView.findFromDOM. Dispatch all 50
    // real editor transactions in one turn: IPC acks cannot drain between them.
    const content = document.querySelector('.cm-content') as HTMLElement & { cmTile: { root: { view: EditorView } } };
    const view = content.cmTile.root.view;
    for (let i = 0; i < 50; i++) {
      const end = view.state.doc.length;
      view.dispatch({ changes: { from: end, insert: char }, selection: { anchor: end + 1 } });
    }
    if (closeBook) document.querySelector<HTMLButtonElement>('.book__close')!.click();
  }, { char, closeBook });
}

test('50 inputs immediately followed by Close persist the complete text and reset both undo stacks', async () => {
  const { app, page, bookRoot } = await launch();
  try {
    await burst(page, 'x', true);
    await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('cat' + 'x'.repeat(50));
    const snapshot = await page.evaluate(async root => {
      const book = await window.desk.openRecent(root);
      return window.desk.openChapter(book.bookId, book.entries[0]!.id);
    }, bookRoot);
    expect(snapshot.canUndoInput).toBe(false);
    expect(snapshot.canUndoApply).toBe(false);
    expect(await readFile(path.join(bookRoot, '01.md'), 'utf8')).toBe('cat');
  } finally { await forceStop(app); }
});

test('failed profile write refuses book close, window close and repeated quit while retaining local text', async () => {
  const { app, page, userData } = await launch();
  try {
    await rename(userData, userData + '-moved');
    roots.push(userData + '-moved');
    await writeFile(userData, 'blocked');
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' local');
    await expect(page.getByText('Ошибка сохранения', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Исходник', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('cat local');
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'окно остаётся открытым' }).first()).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveText('cat local');
    await page.evaluate(() => {
      const state = window as unknown as { closeRequests: number };
      state.closeRequests = 0;
      window.desk.onCloseRequest(async closing => { if (closing) state.closeRequests++; });
    });
    // Observe the request AND restored interactivity, avoiding a pre-request false.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect.poll(() => page.evaluate(() => (window as unknown as { closeRequests: number }).closeRequests)).toBe(1);
    await expect(page.locator('.book')).toHaveJSProperty('inert', false);
    await app.evaluate(({ app }) => { app.quit(); app.quit(); });
    await expect.poll(() => page.evaluate(() => (window as unknown as { closeRequests: number }).closeRequests)).toBe(2);
    await expect(page.locator('.book')).toHaveJSProperty('inert', false);
    await expect(page.locator('.cm-content')).toHaveText('cat local');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally { await forceStop(app); }
});

test('native window close flushes pending text before destroying the window', async () => {
  const { app, page, bookRoot } = await launch();
  try {
    await burst(page, 'y');
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await closed;
    const second = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: await temp('desk-reopen-') } });
    try {
      await second.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, bookRoot);
      const next = await second.firstWindow();
      const snapshot = await next.evaluate(async root => {
        const book = (await window.desk.chooseBook())!;
        return window.desk.openChapter(book.bookId, book.entries[0]!.id);
      }, bookRoot);
      expect(snapshot.text).toBe('cat' + 'y'.repeat(50));
      expect(snapshot.canUndoInput).toBe(false);
      expect(snapshot.canUndoApply).toBe(false);
    } finally { await forceStop(second); }
  } finally { await forceStop(app); }
});

test('successful close stays inert until delayed response unmounts the book and clears populated apply history', async () => {
  const { app, page, bookRoot } = await launch();
  try {
    const applied = await page.evaluate(async root => {
      const book = await window.desk.openRecent(root);
      const chapter = book.entries[0]!.id;
      const initial = await window.desk.openChapter(book.bookId, chapter);
      const edited = await window.desk.command(book.bookId, chapter, initial.revision, {
        type: 'text', changes: [{ from: 0, to: 3, insert: 'dog' }], selection: { anchor: 3, head: 3 },
      });
      return window.desk.command(book.bookId, chapter, edited.revision, { type: 'apply', id: edited.records[0]!.id });
    }, bookRoot);
    expect(applied.canUndoApply).toBe(true);
    await expect(page.locator('.cm-content')).toHaveText('dog');
    await app.evaluate(({ ipcMain }) => {
      // Test-only hold AFTER the real handler closed storage, BEFORE invoke delivery.
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('desk:close-book')!;
      const state = globalThis as unknown as { storageClosed: boolean; releaseClose: () => void };
      state.storageClosed = false;
      const gate = new Promise<void>(resolve => { state.releaseClose = resolve; });
      ipcMain.removeHandler('desk:close-book');
      ipcMain.handle('desk:close-book', async (...args) => {
        const result = await original(...args);
        state.storageClosed = true;
        await gate;
        return result;
      });
    });
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { storageClosed: boolean }).storageClosed)).toBe(true);
    await expect(page.locator('.book')).toHaveJSProperty('inert', true);
    // Browser input cannot enter the now-closed editor during the held handoff.
    await page.keyboard.insertText('lost');
    await expect(page.locator('.cm-content')).toHaveText('dog');
    await app.evaluate(() => (globalThis as unknown as { releaseClose: () => void }).releaseClose());
    await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('dog');
    const reopened = await page.evaluate(async root => {
      const book = await window.desk.openRecent(root);
      return window.desk.openChapter(book.bookId, book.entries[0]!.id);
    }, bookRoot);
    expect(reopened.canUndoApply).toBe(false);
    expect(reopened.canUndoInput).toBe(false);
  } finally { await forceStop(app); }
});
