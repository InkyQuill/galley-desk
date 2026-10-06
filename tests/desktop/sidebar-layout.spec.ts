import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { encodeReview } from '@galley-desk/pocket-format';

const tempDirs: string[] = [];

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function launch(userData: string, bookRoot?: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  if (bookRoot !== undefined) {
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, bookRoot);
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
  }
  return { app, page };
}

async function panelWidth(page: Page, selector: string): Promise<number> {
  return Math.round((await page.locator(selector).boundingBox())?.width ?? 0);
}

async function dragBy(page: Page, separatorName: string, deltaX: number): Promise<void> {
  const separator = page.getByRole('separator', { name: separatorName });
  const box = await separator.boundingBox();
  if (box === null) throw new Error(`separator ${separatorName} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + 80, { steps: 4 });
  await page.mouse.up();
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

test('sidebar widths drag, cancel, keyboard commit and persist independently', async () => {
  const bookRoot = await temp('galley-sidebar-book-');
  const userData = await temp('galley-sidebar-user-');
  await writeFile(path.join(bookRoot, 'Глава.md'), `# Глава\n\n${'строка текста '.repeat(600)}\n`, 'utf8');
  let session = await launch(userData, bookRoot);
  try {
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();
    expect(await panelWidth(page, '.book__chapters')).toBe(315);
    expect(await panelWidth(page, '.book__review')).toBe(336);

    await page.locator('.cm-content').click();
    await page.keyboard.press('Shift+ArrowRight');
    const scroller = page.locator('.cm-scroller');
    await scroller.evaluate(element => { element.scrollTop = 220; });
    const scrollBeforeResize = await scroller.evaluate(element => element.scrollTop);
    await expect(page.locator('.cm-selectionBackground')).toHaveCount(1);

    const manifest = JSON.parse(await readFile(path.join(bookRoot, '.pocket-editor.json'), 'utf8')) as { chapters: Array<{ id: string; path: string }> };
    const reviewPath = path.join(bookRoot, 'Глава.review.json');
    const utf8Review = encodeReview({ schema_version: 1, chapter_id: manifest.chapters[0]!.id, source_path: 'Глава.md', chapter_note: 'ёж — заметка', edits: [], signals: [] });
    await writeFile(reviewPath, utf8Review, 'utf8');

    await dragBy(page, 'Ширина оглавления', 48);
    await expect(page.locator('.book__chapters')).toHaveCSS('width', '363px');
    await expect(page.locator('.cm-selectionBackground')).toHaveCount(1);
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(scrollBeforeResize);

    const reviewSeparator = page.getByRole('separator', { name: 'Ширина рецензии' });
    await reviewSeparator.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    await expect(page.locator('.book__review')).toHaveCSS('width', '368px');

    const beforeCancel = await panelWidth(page, '.book__chapters');
    const box = await page.getByRole('separator', { name: 'Ширина оглавления' }).boundingBox();
    if (box === null) throw new Error('chapters separator has no box');
    await page.mouse.move(box.x + 3, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 43, box.y + 90, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await panelWidth(page, '.book__chapters')).toBe(beforeCancel);
    expect(await readFile(reviewPath, 'utf8')).toBe(utf8Review);

    await session.app.close();
    session = await launch(userData);
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.cm-content')).toBeVisible();
    expect(await panelWidth(session.page, '.book__chapters')).toBe(beforeCancel);
    expect(await panelWidth(session.page, '.book__review')).toBe(368);
  } finally {
    await session.app.close().catch(() => undefined);
  }
});

test('responsive layout has no horizontal overflow and collapsed panels open as focused overlays', async () => {
  const bookRoot = await temp('galley-sidebar-responsive-book-');
  const userData = await temp('galley-sidebar-responsive-user-');
  await writeFile(path.join(bookRoot, 'Глава.md'), `# Глава\n\n${'абзац '.repeat(800)}\n`, 'utf8');
  const session = await launch(userData, bookRoot);
  try {
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();
    for (const width of [1920, 1280, 900]) {
      await page.setViewportSize({ width, height: 850 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await expect(page.locator('.book__review')).toHaveCount(0);
    expect(await panelWidth(page, '.book__chapters')).toBe(315);
    await dragBy(page, 'Ширина оглавления', 32);
    await expect(page.locator('.book__chapters')).toHaveCSS('width', '347px');
    await page.getByRole('button', { name: 'Показать рецензию', exact: true }).click();
    const overlay = page.getByRole('dialog', { name: 'Рецензия' });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Закрыть панель' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Показать рецензию', exact: true })).toBeFocused();

    await page.setViewportSize({ width: 700, height: 850 });
    await expect(page.locator('.book__chapters')).toHaveCount(0);
    await expect(page.locator('.book__review')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Показать оглавление', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Оглавление' })).toBeVisible();
  } finally {
    await session.app.close();
  }
});

test('panel toggles live in the panel headings and collapsed panels keep floating show triggers', async () => {
  const bookRoot = await temp('galley-heading-toggles-book-');
  const userData = await temp('galley-heading-toggles-user-');
  await writeFile(path.join(bookRoot, 'Глава.md'), `# Глава\n\n${'текст '.repeat(400)}\n`, 'utf8');
  const session = await launch(userData, bookRoot);
  try {
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();

    // Wide layout: each toggle lives inside its own panel.
    const chaptersHide = page.locator('.book__chapters-heading').getByRole('button', { name: 'Скрыть оглавление', exact: true });
    await expect(chaptersHide).toBeVisible();
    expect(await chaptersHide.evaluate(el => el.closest('nav.book__chapters') !== null)).toBe(true);
    const reviewHeading = page.locator('.book__review .book__panel-heading');
    await expect(reviewHeading.getByRole('heading', { name: 'Рецензия' })).toBeVisible();
    const reviewHide = reviewHeading.getByRole('button', { name: 'Скрыть рецензию', exact: true });
    await expect(reviewHide).toBeVisible();
    expect(await reviewHide.evaluate(el => el.closest('aside.book__review') !== null)).toBe(true);
    await expect(page.locator('.book__toolbar button[aria-label="Оглавление"]')).toHaveCount(0);
    await expect(page.locator('.book__toolbar button[aria-label="Рецензия"]')).toHaveCount(0);

    // Hiding a panel leaves a floating trigger at the same edge; the reading
    // column keeps the full body width (the trigger is out of the grid flow).
    const bodyWidth = await page.locator('.book__body').evaluate(el => el.getBoundingClientRect().width);
    await chaptersHide.click();
    await expect(page.locator('.book__chapters')).toHaveCount(0);
    const showChapters = page.getByRole('button', { name: 'Показать оглавление', exact: true });
    await expect(showChapters).toBeVisible();
    const chaptersBox = (await showChapters.boundingBox())!;
    expect(chaptersBox.x).toBeLessThanOrEqual(24);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await reviewHide.click();
    await expect(page.locator('.book__review')).toHaveCount(0);
    const showReview = page.getByRole('button', { name: 'Показать рецензию', exact: true });
    await expect(showReview).toBeVisible();
    const reviewBox = (await showReview.boundingBox())!;
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(reviewBox.x + reviewBox.width).toBeGreaterThanOrEqual(clientWidth - 24);
    expect(await page.locator('.book__content').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(bodyWidth, 0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // Clicking a floating trigger restores the panel and moves focus to its heading action.
    await showChapters.click();
    await expect(page.locator('.book__chapters')).toHaveCount(1);
    await expect(chaptersHide).toBeFocused();
    await expect(showChapters).toHaveCount(0);
    await showReview.click();
    await expect(page.locator('.book__review')).toHaveCount(1);
    await expect(reviewHide).toBeFocused();
    await expect(showReview).toHaveCount(0);

    // Narrow layout: width-collapsed panels open as overlays from their
    // floating triggers; Escape closes and returns focus to the trigger.
    // At 900 px only the review panel loses its column (chapters still fits).
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.locator('.book__review')).toHaveCount(0);
    await expect(page.locator('.book__chapters')).toHaveCount(1);
    await expect(showReview).toBeVisible();
    await showReview.click();
    const overlay = page.getByRole('dialog', { name: 'Рецензия' });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Закрыть панель' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(showReview).toBeFocused();
    await page.setViewportSize({ width: 700, height: 700 });
    await expect(page.locator('.book__chapters')).toHaveCount(0);
    await expect(page.locator('.book__review')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(showChapters).toBeVisible();
    await showChapters.click();
    const tocOverlay = page.getByRole('dialog', { name: 'Оглавление' });
    await expect(tocOverlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tocOverlay).toHaveCount(0);
    await expect(showChapters).toBeFocused();

    // Zen hides the collapsed panels together with their floating triggers.
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await expect(showChapters).toHaveCount(0);
    await expect(showReview).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Alt+z');
    await expect(showChapters).toBeVisible();
    await expect(showReview).toBeVisible();
  } finally {
    await session.app.close();
  }
});

test('keyboard width commit survives responsive resizer unmount', async () => {
  const bookRoot = await temp('galley-sidebar-unmount-book-');
  const userData = await temp('galley-sidebar-unmount-user-');
  await writeFile(path.join(bookRoot, 'Глава.md'), '# Глава\n\nТекст.\n', 'utf8');
  const session = await launch(userData, bookRoot);
  try {
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();
    const reviewSeparator = page.getByRole('separator', { name: 'Ширина рецензии' });
    await reviewSeparator.focus();
    await reviewSeparator.press('ArrowLeft');
    await expect(page.locator('.book__review')).toHaveCSS('width', '352px');
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(reviewSeparator).toHaveCount(0);
    await expect.poll(async () => {
      const raw = await readFile(path.join(userData, 'settings.json'), 'utf8').catch(() => null);
      if (raw === null) return undefined;
      const settings = JSON.parse(raw) as { layout?: { reviewWidth?: number } };
      return settings.layout?.reviewWidth;
    }).toBe(352);
  } finally {
    await session.app.close();
  }
});
