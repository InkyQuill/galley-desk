import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

async function launch(bookRoot: string, files: Record<string, Buffer | string> = {}): Promise<Session> {
  const userData = await makeTempDir('galley-userdata-');
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, userData, bookRoot };
}

async function stubDialog(app: ElectronApplication, result: { canceled: boolean; filePaths?: string[] }): Promise<void> {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showOpenDialog = async () => payload as { canceled: boolean; filePaths: string[] };
  }, result);
}

/** Подменяет shell.openExternal шпионом в main (как showOpenDialog в других спеках). */
async function stubShell(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    (globalThis as { __galleyOpenedUrls?: string[] }).__galleyOpenedUrls = [];
    shell.openExternal = async (url: string) => {
      const opened = (globalThis as { __galleyOpenedUrls?: string[] }).__galleyOpenedUrls ?? [];
      opened.push(url);
    };
  });
}

const openedUrls = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as { __galleyOpenedUrls?: string[] }).__galleyOpenedUrls ?? []);

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('http(s)-ссылка уходит во внешний браузер, прочие ссылки инертны', async () => {
  const bookRoot = await makeTempDir('galley-e2e-links-');
  const manifest = {
    schema_version: 1,
    book_id: randomUUID(),
    title: 'Книга со ссылками',
    chapters: [{ id: randomUUID(), path: 'Глава.md', title: 'Глава' }],
    ignored_files: [],
  };
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest, null, 2));
  const session = await launch(bookRoot, {
    'Глава.md': '[внешняя](https://example.com/galley) и [внутренняя](другая.md)\n',
  });
  const { app, page } = session;
  try {
    await stubDialog(app, { canceled: false, filePaths: [bookRoot] });
    await stubShell(app);
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
    const content = page.locator('.cm-content');
    await expect(content).toContainText('внешняя');
    const urlBefore = page.url();

    // http(s)-ссылка: Ctrl+клик — desk:open-external, навигации в окне нет.
    await page.locator('.ge-link[data-ge-url="https://example.com/galley"]').click({ modifiers: ['Control'] });
    await expect.poll(() => openedUrls(app)).toContain('https://example.com/galley');
    expect(page.url()).toBe(urlBefore);
    await expect(content).toContainText('внешняя');

    // Относительная ссылка: инертна — ничего не открывается, окно не покидается.
    await page.locator('.ge-link[data-ge-url="другая.md"]').click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);
    expect(await openedUrls(app)).toEqual(['https://example.com/galley']);
    expect(page.url()).toBe(urlBefore);
    await expect(content).toContainText('внутренняя');
  } finally {
    await app.close();
  }
});
