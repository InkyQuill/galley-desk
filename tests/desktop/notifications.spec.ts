import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

// Рабочие ошибки книги (сбой сохранения, отказ открытия главы, внешнее
// изменение, только-чтение, сбой сохранения ширины) собираются в плавающий
// нижний центр уведомлений (NoticeCenter) вместо нестилизованных flow-полос
// над редактором. Контракт: карточка поверх редактора, центрирована, отступ
// снизу 16–24 px, размеры .book__body/.cm-scroller до и после ошибки не
// меняются, ошибки локальных форм в центр не переезжают.

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return realpath(dir);
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

async function launch(bookRoot: string, files: Record<string, string> = {}): Promise<Session> {
  const userData = await makeTempDir('galley-notices-profile-');
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(bookRoot, name), content, 'utf8');
  }
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page, userData, bookRoot };
}

async function stubDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: root });
  }, filePaths);
}

async function openOwnBook(session: Session): Promise<void> {
  await stubDialog(session.app, [session.bookRoot]);
  await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(session.page.locator('.cm-content')).toBeVisible();
}

/** Сценарий реального сбоя сохранения: каталог книги только для чтения. */
async function failSaves(page: Page, bookRoot: string): Promise<void> {
  await chmod(bookRoot, 0o555);
  await page.locator('.cm-content').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.type('?');
}

async function forceStop(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  await app.close().catch(() => undefined);
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('рабочая ошибка плавает по нижнему центру поверх редактора и не переформатирует его', async () => {
  const bookRoot = await makeTempDir('galley-notices-float-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  try {
    const { page } = session;
    await openOwnBook(session);
    const body = page.locator('.book__body');
    const scroller = page.locator('.cm-scroller');
    const bodyBefore = await body.boundingBox();
    const scrollerBefore = await scroller.boundingBox();
    expect(bodyBefore).not.toBeNull();
    expect(scrollerBefore).not.toBeNull();

    await failSaves(page, bookRoot);
    const notice = page.locator('.notice-center .notice--error');
    await expect(notice).toBeVisible();

    // Один логический сбой — одна карточка с одним действием «Перечитать
    // главу»: сообщение очереди редактора сведено в ту же карточку, дубля
    // внутри редактора больше нет.
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Перечитать главу' })).toHaveCount(1);
    await expect(notice).toContainText('локальный текст сохранён');

    // Карточка центрирована по viewport, нижний отступ 16–24 px, ширина
    // ограничена 640 px, и она перекрывает область редактора.
    const box = (await notice.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    const bottomGap = viewport.height - (box.y + box.height);
    expect(bottomGap).toBeGreaterThanOrEqual(16);
    expect(bottomGap).toBeLessThanOrEqual(24);
    expect(box.width).toBeLessThanOrEqual(641);
    expect(box.y).toBeGreaterThan(bodyBefore!.y);

    // Раскладка не меняется: .book__body и .cm-scroller стоят там же, текст
    // главы не сдвинулся — уведомление живёт вне потока.
    const bodyAfter = await body.boundingBox();
    const scrollerAfter = await scroller.boundingBox();
    for (const [before, after] of [[bodyBefore, bodyAfter], [scrollerBefore, scrollerAfter]] as const) {
      expect(Math.abs(after!.x - before!.x)).toBeLessThan(0.5);
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(0.5);
      expect(Math.abs(after!.width - before!.width)).toBeLessThan(0.5);
      expect(Math.abs(after!.height - before!.height)).toBeLessThan(0.5);
    }
    await expect(page.locator('.cm-content')).toContainText('кот?');

    // За пределами собственной карточки уведомление не перехватывает ввод:
    // точка в центре редактора — по-прежнему контент редактора, клик доходит.
    expect(await page.evaluate(() => {
      const element = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return element?.closest('.cm-content') !== null && element?.closest('.notice-center') === null;
    })).toBe(true);
    await page.locator('.cm-content').click();
    await expect(page.locator('.cm-content')).toBeFocused();

    // Действие карточки работает с клавиатуры и разрешает состояние.
    await chmod(bookRoot, 0o755);
    await page.getByRole('button', { name: 'Перечитать главу' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.notice-center .notice')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await chmod(bookRoot, 0o755).catch(() => undefined);
    await forceStop(session.app);
  }
});

test('карточки складываются вверх с зазором 8px, dismiss и повтор действия разрешают состояния', async () => {
  const bookRoot = await makeTempDir('galley-notices-stack-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  try {
    const { page, app } = session;
    await openOwnBook(session);

    // Второй источник: отказ сохранения ширины панелей.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('desk:set-layout')!;
      (globalThis as unknown as { restoreSetLayout: () => void }).restoreSetLayout = () => {
        ipcMain.removeHandler('desk:set-layout');
        ipcMain.handle('desk:set-layout', original);
      };
      ipcMain.removeHandler('desk:set-layout');
      ipcMain.handle('desk:set-layout', async () => { throw new Error('Test layout save failure'); });
    });
    await page.locator('.book__sidebar-resizer[data-side="chapters"]').focus();
    await page.keyboard.press('ArrowLeft');
    const layoutNotice = page.locator('.notice-center .notice--error', { hasText: 'Test layout save failure' });
    await expect(layoutNotice).toBeVisible();

    // Третий источник: отказ закрытия книги — общая ошибка с крестиком.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desk:close-book');
      ipcMain.handle('desk:close-book', async () => { throw new Error('Test close failure'); });
    });
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    const closeNotice = page.locator('.notice-center .notice--error', { hasText: 'Test close failure' });
    await expect(closeNotice).toBeVisible();

    await failSaves(page, bookRoot);
    await expect(page.locator('.notice-center .notice')).toHaveCount(3);

    // Стек прижат к низу: карточки растут вверх, зазор между соседями 8px,
    // все полностью внутри viewport.
    const viewport = page.viewportSize()!;
    const boxes = (await page.locator('.notice-center .notice').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      }),
    )).sort((a, b) => a.top - b.top);
    expect(boxes).toHaveLength(3);
    for (let index = 1; index < boxes.length; index++) {
      expect(Math.abs(boxes[index]!.top - boxes[index - 1]!.bottom - 8)).toBeLessThanOrEqual(1);
    }
    const bottomGap = viewport.height - boxes[boxes.length - 1]!.bottom;
    expect(bottomGap).toBeGreaterThanOrEqual(16);
    expect(bottomGap).toBeLessThanOrEqual(24);
    for (const box of boxes) {
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
    }

    // Крестик общей ошибки доступен с клавиатуры и снимает ровно её.
    await expect(page.locator('.notice-center').getByRole('button', { name: 'Скрыть уведомление' })).toHaveCount(1);
    await page.locator('.notice-center').getByRole('button', { name: 'Скрыть уведомление' }).focus();
    await page.keyboard.press('Enter');
    await expect(closeNotice).toHaveCount(0);
    await expect(page.locator('.notice-center .notice')).toHaveCount(2);

    // «Повторить сохранение ширины» после устранения отказа убирает карточку.
    await app.evaluate(() => (globalThis as unknown as { restoreSetLayout: () => void }).restoreSetLayout());
    await page.getByRole('button', { name: 'Повторить сохранение ширины' }).click();
    await expect(layoutNotice).toHaveCount(0);
    await expect(page.locator('.notice-center .notice')).toHaveText([/локальный текст сохранён/]);

    // «Перечитать главу» снимает последнюю.
    await chmod(bookRoot, 0o755);
    await page.getByRole('button', { name: 'Перечитать главу' }).click();
    await expect(page.locator('.notice-center .notice')).toHaveCount(0);
  } finally {
    await chmod(bookRoot, 0o755).catch(() => undefined);
    await forceStop(session.app);
  }
});

test('локальные ошибки форм остаются у форм и не дублируются центром', async () => {
  const longYaml = (key0: string): string => Array.from({ length: 60 }, (_, index) => `${index === 0 ? 'key0' : `key${index}`}: ${index === 0 ? key0 : `значение${index}`}`).join('\n');
  const bookRoot = await makeTempDir('galley-notices-local-');
  const session = await launch(bookRoot, { 'Глава.md': `---\n${longYaml('черновик')}\n---\nкот\n` });
  try {
    const { page } = session;
    await openOwnBook(session);

    // Метаданные: черновик правится, исходник меняется извне — сохранение
    // отклоняется с формной ошибкой внутри попапа.
    await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
    const yaml = page.getByLabel('YAML метаданных');
    await yaml.fill('key0: правится\n');
    await writeFile(path.join(bookRoot, 'Глава.md'), `---\n${longYaml('чужая')}\n---\nкот\n`, 'utf8');
    await page.getByRole('button', { name: 'Сохранить метаданные' }).click();
    const formAlert = page.getByRole('dialog', { name: 'Метаданные главы' }).getByRole('alert');
    await expect(formAlert).toBeVisible();

    // Общий центр пуст: формная ошибка не превращается в карточку книги, и во
    // всём приложении ровно один alert — внутри формы.
    await expect(page.locator('.notice-center .notice')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(1);

    // Попап закрывается с отбрасыванием черновика.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Отбросить', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toHaveCount(0);

    // Теперь рабочий сбой: карточка в центре; попап метаданных (перечитанный
    // длинный YAML, read-only при сбое) растягивается вниз и остаётся ВЫШЕ
    // карточки в зоне перекрытия.
    await failSaves(page, bookRoot);
    await expect(page.locator('.notice-center .notice--error')).toBeVisible();
    await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeVisible();
    const overlapping = await page.locator('.book__metadata-popover').evaluate((popover) => {
      const layer = popover.parentElement as HTMLElement;
      const rect = layer.getBoundingClientRect();
      const notice = document.querySelector('.notice-center .notice--error');
      if (notice === null) return 'no-notice';
      const noticeRect = notice.getBoundingClientRect();
      const overlapX = Math.max(rect.left, noticeRect.left) < Math.min(rect.right, noticeRect.right);
      const overlapY = Math.max(rect.top, noticeRect.top) < Math.min(rect.bottom, noticeRect.bottom);
      if (!overlapX || !overlapY) return 'no-overlap';
      const x = (Math.max(rect.left, noticeRect.left) + Math.min(rect.right, noticeRect.right)) / 2;
      const y = (Math.max(rect.top, noticeRect.top) + Math.min(rect.bottom, noticeRect.bottom)) / 2;
      return (document.elementFromPoint(x, y)?.closest('.book__metadata-popover') !== null) ? 'popover-on-top' : 'covered';
    });
    expect(overlapping).toBe('popover-on-top');
    await expect(page.locator('.notice-center')).toContainText('локальный текст сохранён');

    // Слои закрываются независимо: Escape прячет попап, карточка остаётся до
    // явного разрешения состояния.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toHaveCount(0);
    await expect(page.locator('.notice-center .notice--error')).toBeVisible();
  } finally {
    await chmod(bookRoot, 0o755).catch(() => undefined);
    await forceStop(session.app);
  }
});

test('на 900px и 700px карточка не перекрывает floating-триггеры панелей', async () => {
  const bookRoot = await makeTempDir('galley-notices-narrow-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  try {
    const { page } = session;
    await openOwnBook(session);
    await failSaves(page, bookRoot);
    const notice = page.locator('.notice-center .notice--error');
    await expect(notice).toBeVisible();

    for (const width of [900, 700]) {
      await page.setViewportSize({ width, height: 600 });
      await expect(page.locator('.notice-center .notice--error')).toBeVisible();
      const overlap = await page.evaluate(() => {
        const noticeRect = document.querySelector('.notice-center .notice')?.getBoundingClientRect();
        if (noticeRect === undefined) return 'no-notice';
        return [...document.querySelectorAll('.book__panel-trigger')].some((trigger) => {
          const rect = trigger.getBoundingClientRect();
          return rect.left < noticeRect.right && rect.right > noticeRect.left && rect.top < noticeRect.bottom && rect.bottom > noticeRect.top;
        }) ? 'overlaps' : 'clear';
      });
      expect(overlap).toBe('clear');
      await page.screenshot({ path: `test-results/task8-narrow-${width}.png` });
    }

    // Возврат к ширине: карточка жива, раскладка та же (уведомление вне потока).
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(notice).toBeVisible();
  } finally {
    await chmod(bookRoot, 0o755).catch(() => undefined);
    await forceStop(session.app);
  }
});

test('темы, зум и только-чтение: скриншоты карточек уведомлений', async () => {
  const bookRoot = await makeTempDir('galley-notices-themes-');
  const session = await launch(bookRoot, { 'Глава.md': 'кот\n' });
  try {
    const { page, app } = session;
    await openOwnBook(session);
    await failSaves(page, bookRoot);
    await expect(page.locator('.notice-center .notice--error')).toBeVisible();

    await page.screenshot({ path: 'test-results/task8-error-light-1280.png' });

    // Тёмная тема через панель оформления.
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.getByLabel('Тема', { exact: true }).selectOption('gruvbox-dark');
    await page.getByRole('button', { name: 'Закрыть оформление' }).click();
    await page.screenshot({ path: 'test-results/task8-error-dark-1280.png' });

    // 1920px × 125%.
    await page.setViewportSize({ width: 1920, height: 900 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.25));
    await page.screenshot({ path: 'test-results/task8-error-dark-1920-125.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));

    // Стек внешнего изменения: чужая версия на диске → «Перечитать главу»
    // снимает локальный сбой → ввод отклоняется (STALE_REVISION) маскированным
    // сообщением очереди без «Перечитать главу» и без смены чипа.
    await chmod(bookRoot, 0o755);
    await writeFile(path.join(bookRoot, 'Глава.md'), 'чужая версия', 'utf8');
    await expect(page.getByRole('button', { name: 'Открыть внешнюю версию' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Перечитать главу' }).click();
    await expect(page.getByText('Внешнее изменение')).toBeVisible();
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await page.keyboard.type('#');
    await expect(page.locator('.notice-center')).toContainText('локальный текст сохранён');
    await expect(page.getByText('Ошибка сохранения')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Перечитать главу' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/task8-stack-external-dark-1280.png' });
  } finally {
    await chmod(bookRoot, 0o755).catch(() => undefined);
    await forceStop(session.app);
  }

  // Только-чтение: постоянное warning-уведомление без действий.
  const readonlyRoot = await makeTempDir('galley-notices-readonly-');
  const manifest = JSON.stringify({ schema_version: 1, book_id: '99999999-9999-4999-8999-999999999999', title: 'Read only', chapters: [{ id: '11111111-1111-4111-8111-111111111111', path: 'chapter.md', title: 'Chapter' }], ignored_files: [] });
  const readonlySession = await launch(readonlyRoot, { '.pocket-editor.json': manifest, 'chapter.md': 'original\r\n', 'chapter.review.json': '{ broken' });
  try {
    const { page } = readonlySession;
    await openOwnBook(readonlySession);
    const warning = page.locator('.notice-center .notice--warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Только чтение');
    // Постоянное: без крестика и без действий, один alert на состояние.
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(warning.getByRole('button')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/task8-readonly-warning-light-1280.png' });
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.getByLabel('Тема', { exact: true }).selectOption('gruvbox-dark');
    await page.getByRole('button', { name: 'Закрыть оформление' }).click();
    await page.screenshot({ path: 'test-results/task8-readonly-warning-dark-1280.png' });
  } finally {
    await forceStop(readonlySession.app);
  }
});
