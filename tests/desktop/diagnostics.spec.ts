import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

// Real end-to-end proof of the diagnostics wiring from Task 2: a renderer
// exception that carries manuscript-shaped text reaches the local log file
// as a closed-vocabulary `unhandled-renderer` record, and the secret text
// itself never does -- not even truncated, not even inside a stack frame.
// Uses a temp book root and a temp userData profile (GALLEY_DESK_USER_DATA),
// exactly like tests/desktop/close-pending.spec.ts -- never the real user
// profile.

const roots: string[] = [];
async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function launch() {
  const bookRoot = await temp('desk-diag-book-');
  const userData = await temp('desk-diag-profile-');
  await writeFile(path.join(bookRoot, '01.md'), 'cat');
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: userData } });
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(page.locator('.cm-content')).toHaveText('cat');
  return { app, page, userData };
}

async function forceStop(app: ElectronApplication) {
  let child;
  try {
    child = app.process();
  } catch {
    return;
  }
  const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await exited;
}

// The logger's active file (see main/diagnostics/logger.ts's ACTIVE_NAME)
// is diagnostics.log, not main.log: this is Task 1's already-established
// filename, kept exactly as merged rather than the plan text's example name.
function logPath(userData: string): string {
  return path.join(userData, 'logs', 'diagnostics.log');
}

async function readLogOrEmpty(file: string): Promise<string> {
  return readFile(file, 'utf8').catch(() => '');
}

test('an uncaught renderer exception is logged as unhandled-renderer without leaking its message', async () => {
  const { app, page, userData } = await launch();
  try {
    const secret = 'PRIVATE manuscript sentence';
    await page.evaluate((message) => {
      setTimeout(() => {
        throw new Error(message);
      }, 0);
    }, secret);
    await expect.poll(() => readLogOrEmpty(logPath(userData))).toContain('unhandled-renderer');
    const contents = await readFile(logPath(userData), 'utf8');
    expect(contents).not.toContain(secret);
    const record = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.event === 'unhandled-renderer');
    expect(record).toMatchObject({ level: 'error', process: 'renderer' });
    expect(JSON.stringify(record)).not.toContain(secret);
  } finally {
    await forceStop(app);
  }
});

test('an unhandled renderer promise rejection is logged the same way', async () => {
  const { app, page, userData } = await launch();
  try {
    const secret = 'PRIVATE rejection payload';
    await page.evaluate((message) => {
      Promise.reject(new Error(message));
    }, secret);
    await expect.poll(() => readLogOrEmpty(logPath(userData))).toContain('unhandled-renderer');
    const contents = await readFile(logPath(userData), 'utf8');
    expect(contents).not.toContain(secret);
  } finally {
    await forceStop(app);
  }
});

test('a forced renderer-only crash is logged as renderer-gone with the enum reason/exit code, and the app recovers without hanging', async () => {
  const { app, userData } = await launch();
  try {
    // Force-crash ONLY the renderer process (never the main process) via
    // Electron's own webContents module, reached through Playwright's
    // main-process `evaluate` bridge -- the same mechanism the existing
    // harness already uses for `dialog` above. `forcefullyCrashRenderer()`
    // kills the renderer's OS process, which Chromium/Electron then reports
    // through the main process's `render-process-gone` event exactly like a
    // real renderer crash would.
    await app.evaluate(({ webContents }) => {
      const [contents] = webContents.getAllWebContents();
      contents.forcefullyCrashRenderer();
    });

    await expect.poll(() => readLogOrEmpty(logPath(userData))).toContain('renderer-gone');
    const contents = await readFile(logPath(userData), 'utf8');
    const record = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.event === 'renderer-gone');
    expect(record).toMatchObject({ level: 'error', process: 'main' });
    // Only the closed enum reason/exit-code pair, e.g. "crashed(0)" --
    // never a message, URL or path. No arbitrary renderer-supplied text
    // reaches the log.
    expect(record?.code).toMatch(/^[a-z-]+\(-?\d+\)$/);

    // The main process is unaffected by the renderer's death, but "no hang"
    // must be proven against the app's REAL quit path (`before-quit` in
    // main.ts), not `app.exit()`. Electron's `app.exit()` terminates
    // immediately and explicitly skips `before-quit`/`will-quit`, so it
    // never exercises this task's new bounded flush logic
    // (`prepareClose()` -> `flushRenderer()` per window -> `session-end` ->
    // `Promise.race([logger.flush(), 500ms])` -> `app.quit()`). `app.close()`
    // is the same real-quit trigger the "a clean quit ..." test below uses.
    // Racing it against a bounded timeout (comfortably above the app's own
    // 500ms flush cap, but small enough that a genuine hang fails promptly)
    // proves the real quit flow survives a dead renderer's `WebContents`
    // rather than hanging on its now-unanswerable flush handshake.
    const closed = app.close();
    const outcome = await Promise.race([
      closed.then(() => 'quit' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5_000)),
    ]);
    expect(outcome).toBe('quit');
  } finally {
    // Idempotent: if `app.close()` above already completed the quit, this
    // is a harmless no-op (the process is already gone).
    await forceStop(app);
  }
});

// --- Task 3: diagnostics panel UI (info + two safe actions) ----------------
//
// The titlebar's "Диагностика" button (renderer/TitleBar.tsx) is the single
// entry point mounted above both the welcome/recent-books screen and an
// open book, so these scenarios exercise both contexts through the same
// button rather than duplicating it.

async function launchWelcome() {
  const userData = await temp('desk-diag-profile-');
  const app = await electron.launch({ args: ['apps/desktop'], env: { ...process.env, GALLEY_DESK_USER_DATA: userData } });
  const page = await app.firstWindow();
  await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
  return { app, page, userData };
}

test('the diagnostics panel opens from the welcome screen by keyboard, shows read-only info with logging status, and Escape returns focus to the button that opened it', async () => {
  const { app, page } = await launchWelcome();
  try {
    const trigger = page.getByRole('button', { name: 'Диагностика' });
    await trigger.focus();
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Диагностика' });
    await expect(dialog).toBeVisible();
    // Read-only info includes a live logging status, never a path.
    await expect(dialog.getByText(/Ведётся|Недоступен/)).toBeVisible();
    await expect(dialog).not.toContainText('logs');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await forceStop(app);
  }
});

test('the diagnostics panel opens the same way from an open book, and Escape again returns focus to the titlebar button', async () => {
  const { app, page } = await launch();
  try {
    const trigger = page.getByRole('button', { name: 'Диагностика' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Диагностика' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await forceStop(app);
  }
});

test('the copy-info action is reachable and activatable by keyboard alone, and requires its own explicit press', async () => {
  const { app, page } = await launchWelcome();
  try {
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('sentinel-before-copy');
    });
    await page.getByRole('button', { name: 'Диагностика' }).click();
    const dialog = page.getByRole('dialog', { name: 'Диагностика' });
    await expect(dialog).toBeVisible();
    // Opening the panel alone must not have copied anything yet.
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('sentinel-before-copy');
    const copyButton = dialog.getByRole('button', { name: 'Скопировать сведения' });
    await copyButton.focus();
    await copyButton.press('Enter');
    await expect(dialog.getByRole('status')).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain('Galley Desk');
  } finally {
    await forceStop(app);
  }
});

test('a shell.openPath failure is shown visibly in the panel, not just logged to the console', async () => {
  const { app, page } = await launchWelcome();
  try {
    await app.evaluate(({ shell }) => {
      shell.openPath = async () => 'No application is registered to open this file';
    });
    await page.getByRole('button', { name: 'Диагностика' }).click();
    const dialog = page.getByRole('dialog', { name: 'Диагностика' });
    const openFolderButton = dialog.getByRole('button', { name: 'Открыть папку журнала' });
    await openFolderButton.focus();
    await openFolderButton.press('Enter');
    await expect(dialog.getByRole('alert')).toBeVisible();
  } finally {
    await forceStop(app);
  }
});

test('passing an arbitrary path over the open-logs-folder channel does not change the directory that gets opened', async () => {
  const { app, page, userData } = await launchWelcome();
  try {
    const opened: string[] = [];
    await app.evaluate(({ shell }) => {
      const calls: string[] = ((globalThis as unknown as { __openPathCalls?: string[] }).__openPathCalls ??= []);
      shell.openPath = async (target: string) => {
        calls.push(target);
        return '';
      };
    });
    // Simulate a compromised renderer sending an arbitrary extra argument on
    // the same channel the real preload uses -- the exposed desk.openLogsFolder()
    // itself takes no parameter, so this goes through the page's own
    // ipcRenderer-free contextBridge surface exactly as a real attacker would
    // be limited to: calling the exposed method with extra JS arguments,
    // which the function signature simply ignores.
    await page.evaluate(() => (window.desk.openLogsFolder as (...args: unknown[]) => Promise<void>)('/etc/passwd'));
    const calls = await app.evaluate(() => (globalThis as unknown as { __openPathCalls?: string[] }).__openPathCalls ?? []);
    opened.push(...calls);
    expect(opened).toHaveLength(1);
    expect(opened[0]).not.toBe('/etc/passwd');
    expect(opened[0]).toBe(path.join(userData, 'logs'));
  } finally {
    await forceStop(app);
  }
});

test('a clean quit writes session-start and session-end without hanging the app', async () => {
  const { app, page, userData } = await launch();
  await page.getByRole('button', { name: 'Меню книги' }).click();
  await page.getByRole('button', { name: 'Закрыть книгу' }).click();
  await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
  const closed = app.close();
  await closed;
  const contents = await readFile(logPath(userData), 'utf8');
  const events = contents
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as Record<string, unknown>).event);
  expect(events).toContain('session-start');
  expect(events).toContain('session-end');
});
