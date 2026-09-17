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

    // The main process is unaffected by the renderer's death: quitting the
    // app right after the crash must still complete promptly, not hang.
    // Playwright's `page` handle for the now-dead renderer target is itself
    // "crashed" and cannot be reused (e.g. `page.reload()` rejects with
    // "Page crashed"), so app-level recovery is proven the way the brief
    // allows -- via a bounded, non-hanging quit -- rather than by resuming
    // interaction with the dead renderer's Playwright handle.
    const quit = forceStop(app);
    const outcome = await Promise.race([
      quit.then(() => 'quit' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
    ]);
    expect(outcome).toBe('quit');
  } finally {
    // Idempotent: if the race above already completed the quit, this is a
    // harmless no-op (the process is already gone).
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
