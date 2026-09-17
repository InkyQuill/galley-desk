import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const source = process.env.GALLEY_TASK13_REAL_BOOK;
if (!source) throw new Error('Set GALLEY_TASK13_REAL_BOOK to the read-only source book');
const root = process.cwd();
const evidence = path.join(root, 'docs/reviews/evidence/workspace-ux/task-13');
await mkdir(evidence, { recursive: true });

async function hashTree(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(current: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const target = path.join(current, name);
      const info = await stat(target);
      const relative = path.relative(directory, target);
      hash.update(relative); hash.update('\0');
      if (info.isDirectory()) await visit(target);
      else hash.update(await readFile(target));
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

const originalBefore = await hashTree(source);
const scratch = await mkdtemp(path.join(tmpdir(), 'galley-task13-real-book-'));
const book = path.join(scratch, 'book');
const userData = path.join(scratch, 'profile');
await cp(source, book, { recursive: true, preserveTimestamps: true });
await mkdir(userData);

const app = await electron.launch({
  args: ['apps/desktop'],
  env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
});

try {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, book);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();

  const setTheme = async (theme: string): Promise<void> => {
    await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.getByLabel('Тема').selectOption(theme);
    await page.getByRole('button', { name: 'Закрыть оформление' }).click();
  };

  for (const [themeName, themeId] of [['light', 'galley-light'], ['dark', 'gruvbox-dark']] as const) {
    await setTheme(themeId);
    for (const width of [900, 1280, 1920]) {
      for (const zoom of [1, 1.25]) {
        await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(factor), zoom);
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: path.join(evidence, `matrix-${themeName}-${width}-${Math.round(zoom * 100)}.png`) });
      }
    }
  }

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
  await page.setViewportSize({ width: 1280, height: 900 });
  await setTheme('gruvbox-dark');

  const chapter = page.locator('.book__chapter').nth(1);
  if (await chapter.count()) await chapter.click();
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByRole('button', { name: /Действия главы:/ }).first().click();
  await page.screenshot({ path: path.join(evidence, 'real-book-sidebar-menu.png') });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Найти главы в папке' }).click();
  await expect(page.getByRole('dialog', { name: 'Найти главы в папке' })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-discovery.png') });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Сортировать главы' }).click();
  await expect(page.getByRole('dialog', { name: 'Сортировать главы' })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-sort-preview.png') });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Метаданные главы' }).click();
  await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-metadata.png') });
  await page.keyboard.press('Escape');

  const zenButton = page.getByRole('button', { name: 'Режим Zen', exact: true });
  await zenButton.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-themed-tooltip.png') });
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+f');
  const search = page.getByRole('textbox', { name: 'Поиск по главе' });
  await search.fill('и');
  await expect(page.locator('.book__search-counter')).toContainText(/\d+\/\d+/);
  await page.screenshot({ path: path.join(evidence, 'real-book-search-first-match.png') });
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();

  await page.screenshot({ path: path.join(evidence, 'real-book-dense-review.png') });
  const scroller = page.locator('.book__text .cm-scroller');
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
  await expect(page.locator('.book__comparison')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-comparison-middle.png') });

  await page.getByRole('button', { name: 'Режим Zen', exact: true }).click();
  await expect(page.locator('.book--zen')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-zen.png') });
  await page.getByRole('button', { name: 'Выйти из Zen', exact: true }).click();

  const reviewFiles = (await readdir(book)).filter(name => name.endsWith('.review.json'));
  let records = 0;
  for (const name of reviewFiles) {
    const review = JSON.parse(await readFile(path.join(book, name), 'utf8')) as { edits?: unknown[]; signals?: unknown[] };
    records += (review.edits?.length ?? 0) + (review.signals?.length ?? 0);
  }
  const result = {
    source,
    sourceHashBefore: originalBefore,
    sourceHashAfter: await hashTree(source),
    copiedBook: path.basename(scratch),
    markdownFiles: (await readdir(book)).filter(name => name.endsWith('.md')).length,
    reviewFiles: reviewFiles.length,
    records,
    screenshots: (await readdir(evidence)).filter(name => name.endsWith('.png')).sort(),
  };
  await writeFile(path.join(evidence, 'capture-result.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
}
