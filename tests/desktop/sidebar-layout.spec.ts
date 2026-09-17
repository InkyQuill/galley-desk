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
    await page.getByRole('button', { name: 'Рецензия', exact: true }).click();
    const overlay = page.getByRole('dialog', { name: 'Рецензия' });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Закрыть панель' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Рецензия', exact: true })).toBeFocused();

    await page.setViewportSize({ width: 700, height: 850 });
    await expect(page.locator('.book__chapters')).toHaveCount(0);
    await expect(page.locator('.book__review')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Оглавление' })).toBeVisible();
  } finally {
    await session.app.close();
  }
});
