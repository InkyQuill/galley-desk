import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Review } from '../../../../../packages/pocket-format/src/index';
import { openChapter } from '../../../../../packages/review-engine/src/index';

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

async function firstVisibleText(page: Page, selector: string): Promise<string | null> {
  return page.locator(selector).evaluateAll((nodes) => {
    const scroller = document.querySelector('.book__text .cm-scroller, .book__comparison');
    if (!scroller) return null;
    const viewport = scroller.getBoundingClientRect();
    const visible = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    return visible.at(Math.floor(visible.length / 2))?.textContent?.trim() || null;
  });
}

async function placeCaret(page: Page, textLength: number, offset: number): Promise<void> {
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  for (let index = offset; index < textLength; index++) await page.keyboard.press('ArrowLeft');
}

async function waitDecodedText(sidecar: string, sourceBytes: Buffer, expected: string): Promise<Review> {
  let review: Review | null = null;
  await expect.poll(async () => {
    try {
      review = JSON.parse(await readFile(sidecar, 'utf8')) as Review;
      return openChapter(sourceBytes, review).text;
    } catch {
      return null;
    }
  }).toBe(expected);
  return review!;
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

  const manifest = JSON.parse(await readFile(path.join(book, '.pocket-editor.json'), 'utf8')) as {
    book_id: string;
    chapters: Array<{ id: string; path: string; title?: string }>;
  };
  const chapterRow = (chapterPath: string) => page.locator('.book__chapter').filter({
    has: page.locator('small', { hasText: new RegExp(`^${chapterPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
  const denseChapter = manifest.chapters.find(chapter => chapter.path === 'chapter-003.md')!;
  await chapterRow(denseChapter.path).click();
  await expect(page.locator('.book__chapter-row--active .book__chapter small')).toHaveText(denseChapter.path);
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByRole('button', { name: /Действия главы:/ }).first().click();
  const assertMenuPainted = async () => {
    expect(await page.locator('.book__chapter-menu-items').evaluate(el => [...el.querySelectorAll('button')].every(button => {
      const r = button.getBoundingClientRect();
      return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8 && button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }))).toBe(true);
    expect(await page.locator('.book__chapters').evaluate(el => el.scrollLeft)).toBe(0);
  };
  await assertMenuPainted();
  await page.screenshot({ path: path.join(evidence, 'real-book-sidebar-menu.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Действия главы:/ }).last().click();
  await assertMenuPainted();
  await page.screenshot({ path: path.join(evidence, 'real-book-last-row-menu.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 700, height: 600 });
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await page.getByRole('button', { name: /Действия главы:/ }).last().click();
  await assertMenuPainted();
  await page.screenshot({ path: path.join(evidence, 'real-book-overlay-menu.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.book__sidebar-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
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
  for (const width of [1100, 900]) {
    await page.setViewportSize({ width, height: 600 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.25));
    await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
    await page.getByLabel('YAML метаданных').fill(`title: Layout draft\n${'description: long yaml preview\n'.repeat(60)}`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await page.locator('.book__metadata-popover').evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8 && el.scrollWidth <= el.clientWidth;
    })).toBe(true);
    await page.screenshot({ path: path.join(evidence, `real-book-metadata-${width}-125-discard.png`) });
    await page.getByRole('button', { name: 'Отбросить', exact: true }).click();
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press('Escape');

  const zenButton = page.getByRole('button', { name: 'Режим Zen', exact: true });
  await zenButton.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-themed-tooltip.png') });
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+f');
  const search = page.getByRole('textbox', { name: 'Поиск по главе' });
  await search.fill('Эльф');
  await expect(search).toBeFocused();
  await expect(page.locator('.book__search-counter')).toContainText(/\d+\/\d+/);
  await expect(page.locator('.gd-search-highlight')).toHaveCount(1);
  await expect(page.locator('.gd-search-highlight')).toBeInViewport();
  await page.screenshot({ path: path.join(evidence, 'real-book-search-first-match.png') });
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();

  const filter = page.getByRole('textbox', { name: 'Фильтр глав' });
  await filter.fill('chapter-015.md');
  await expect(page.locator('.book__chapter')).toHaveCount(1);
  await expect(page.locator('.book__chapter small')).toHaveText('chapter-015.md');
  await filter.fill('');
  await expect(page.locator('.book__chapter')).toHaveCount(manifest.chapters.length);

  await expect(page.getByRole('navigation', { name: 'Рецензия главы' }).getByRole('listitem')).toHaveCount(36);
  await page.screenshot({ path: path.join(evidence, 'real-book-dense-review.png') });

  const atomicChapter = manifest.chapters.find(chapter => chapter.path === 'chapter-015.md')!;
  await chapterRow(atomicChapter.path).click();
  await expect(page.locator('.book__chapter-row--active .book__chapter small')).toHaveText(atomicChapter.path);
  const sourcePath = path.join(book, atomicChapter.path);
  const sidecarPath = path.join(book, atomicChapter.path.replace(/\.md$/, '.md.review.json'));
  const sourceBytes = await readFile(sourcePath);
  const snapshot = await page.evaluate(
    ({ bookId, chapterId }) => window.desk.openChapter(bookId, chapterId),
    { bookId: manifest.book_id, chapterId: atomicChapter.id },
  );
  const originalReview = JSON.parse(await readFile(sidecarPath, 'utf8')) as Review;
  const originalText = snapshot.text;

  const runAtomic = async (offset: number, insertion: string): Promise<void> => {
    const expected = originalText.slice(0, offset) + insertion + originalText.slice(offset);
    await placeCaret(page, originalText.length, offset);
    await page.keyboard.insertText(insertion);
    const changedReview = await waitDecodedText(sidecarPath, sourceBytes, expected);
    for (const edit of originalReview.edits) expect(changedReview.edits.find(candidate => candidate.id === edit.id)).toEqual(edit);
    for (const signal of originalReview.signals) expect(changedReview.signals.find(candidate => candidate.id === signal.id)).toEqual(signal);
    await page.keyboard.press('ControlOrMeta+z');
    await waitDecodedText(sidecarPath, sourceBytes, originalText);
    expect(JSON.parse(await readFile(sidecarPath, 'utf8'))).toEqual(originalReview);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await waitDecodedText(sidecarPath, sourceBytes, expected);
    expect(JSON.parse(await readFile(sidecarPath, 'utf8'))).toEqual(changedReview);
    await page.keyboard.press('ControlOrMeta+z');
    await waitDecodedText(sidecarPath, sourceBytes, originalText);
  };

  const words = [...originalText.matchAll(/[\p{L}]{4,}/gu)];
  const lastWord = words.at(-1)!;
  await runAtomic(lastWord.index! + Math.floor(lastWord[0].length / 2), '·');
  const paragraphBoundary = originalText.lastIndexOf('\n\n');
  expect(paragraphBoundary).toBeGreaterThan(0);
  await runAtomic(paragraphBoundary, '!');

  await chapterRow(denseChapter.path).click();
  await expect(page.locator('.book__chapter-row--active .book__chapter small')).toHaveText(denseChapter.path);
  await expect(page.locator('.cm-content')).toBeVisible();
  const scroller = page.locator('.book__text .cm-scroller');
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  await expect.poll(() => firstVisibleText(page, '.cm-line')).not.toBeNull();
  const textAnchor = await firstVisibleText(page, '.cm-line');
  expect(textAnchor).not.toBeNull();
  await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
  await expect(page.locator('.book__comparison')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-comparison-middle.png') });

  await page.getByRole('button', { name: 'Меню книги', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть книгу', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
  await page.locator('.recent-list__item').getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.book__chapter-row--active .book__chapter small')).toHaveText(denseChapter.path);
  await expect.poll(() => firstVisibleText(page, '.cm-line')).toBe(textAnchor);
  await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
  await expect(page.locator('.book__comparison')).toBeVisible();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await expect.poll(() => firstVisibleText(page, '.cm-line')).toBe(textAnchor);

  await page.getByRole('button', { name: 'Режим Zen', exact: true }).click();
  await expect(page.locator('.book--zen')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'real-book-zen.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.book--zen')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+z' : 'Control+Alt+z');
  await expect(page.locator('.book--zen')).toHaveCount(0);

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
    stories: {
      '1': 'picker and Recent reopened the same active real-book chapter',
      '6': 'Zen survived two Escapes and exited through the dedicated shortcut',
      '7': 'shared themed tooltip was visible from keyboard focus',
      '8': 'search retained input focus and selected the first real match',
      '9': 'filename filter reduced the real 27-chapter spine to chapter-015.md',
      '10': 'chapter-003 rendered all 36 review records',
      '11': 'Text/Comparison and close/Recent reopen restored the same visible text anchor',
      '12': 'middle-word and paragraph-boundary groups passed exact Undo/Redo record checks',
    },
    screenshots: (await readdir(evidence)).filter(name => name.endsWith('.png')).sort(),
  };
  await writeFile(path.join(evidence, 'capture-result.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
}
