// Electron-тесты поиска, фильтра глав, оформления и Zen. Запуск — по
// собранному Forge-входу (.vite/build): сначала `npm run package`.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { encodeReview, makeAnchor } from '@galley-desk/pocket-format';

const tempDirs: string[] = [];

/** Позиция подстроки в байтах (Uint8Array.indexOf не ищет по массиву-игле). */
function byteIndexOf(haystack: Uint8Array, needle: string): number {
  const pattern = new TextEncoder().encode(needle);
  outer: for (let start = 0; start + pattern.length <= haystack.length; start++) {
    for (let index = 0; index < pattern.length; index++) {
      if (haystack[start + index] !== pattern[index]) continue outer;
    }
    return start;
  }
  return -1;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

/** Отдельные temp book и temp userData на каждый тест; книга открывается диалогом. */
async function launchWithBook(
  files: Record<string, string | Buffer>,
): Promise<Session & { openByDialog: () => Promise<void> }> {
  const bookRoot = await makeTempDir('galley-e2e-search-book-');
  const userData = await makeTempDir('galley-e2e-search-user-');
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
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, bookRoot);
  const openByDialog = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Открыть папку…' }).click();
  };
  return { app, page, userData, bookRoot, openByDialog };
}

async function closeApp(session: { app: ElectronApplication }): Promise<void> {
  await session.app.close();
}

/** Повторный запуск в том же профиле: книга открывается из недавних. */
async function relaunch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['apps/desktop'],
    env: { ...process.env, GALLEY_DESK_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  return { app, page };
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Sidecar с одной правкой before → after (якорь по настоящему makeAnchor). */
async function writeEditSidecar(
  bookRoot: string,
  chapterPath: string,
  chapterText: string,
  before: string,
  after: string,
): Promise<void> {
  const manifestPath = path.join(bookRoot, '.pocket-editor.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    chapters: Array<{ id: string; path: string }>;
  };
  const chapter = manifest.chapters.find((entry) => entry.path === chapterPath)!;
  const bytes = new TextEncoder().encode(chapterText);
  const from = byteIndexOf(bytes, before);
  if (from < 0) throw new Error(`Подстрока не найдена: ${before}`);
  const review = {
    schema_version: 1 as const,
    chapter_id: chapter.id,
    source_path: chapterPath,
    chapter_note: '',
    edits: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        before,
        after,
        anchor: makeAnchor(bytes, { from, to: from + new TextEncoder().encode(before).length }),
      },
    ],
    signals: [],
  };
  await writeFile(
    path.join(bookRoot, chapterPath.replace(/\.md$/, '.review.json')),
    encodeReview(review),
    'utf8',
  );
}

test('поиск в «Тексте»: счётчик, переходы, выделение в редакторе, обновление по ревизии', async () => {
  const paragraph = 'кот спит на подоконнике.\n\n';
  const session = await launchWithBook({
    'Глава 1.md': `# Глава первая\n\n${paragraph.repeat(40)}`,
  });
  const { page, openByDialog } = session;
  try {
    await openByDialog();
    // Название главы берётся из первого заголовка Markdown.
    await expect(page.getByRole('button', { name: 'Глава первая' })).toBeVisible();
    await page.getByRole('button', { name: 'Глава первая' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();

    // Область поиска подписана видом.
    await page.keyboard.press('Control+f');
    const search = page.getByRole('search', { name: 'Поиск по главе (Текст)' });
    await expect(search).toBeVisible();

    // 40 абзацев × 1 «кот» в тексте главы (заголовок «Глава первая» не содержит).
    // Первая находка — далеко ниже исходного viewport (40 абзацев): запрос
    // сразу показывает 1/40, подсвечивает находку и скроллит к ней, а фокус
    // остаётся в поле поиска (история №8) -- без клика «Далее».
    const searchField = page.getByRole('textbox', { name: 'Поиск по главе' });
    await searchField.fill('кот');
    await expect(page.locator('.book__search-counter')).toHaveText('1/40');
    await expect(page.locator('.gd-search-highlight')).toHaveCount(1);
    await expect(page.locator('.gd-search-highlight')).toBeInViewport();
    await expect(searchField).toBeFocused();
    // Печать ещё одного символа продолжает работать (счётчик и подсветка обновляются).
    await searchField.fill('коты');
    await expect(page.locator('.book__search-counter')).toHaveText('нет совпадений');
    await expect(page.locator('.gd-search-highlight')).toHaveCount(0);
    await expect(searchField).toBeFocused();
    await searchField.fill('кот');
    await expect(page.locator('.book__search-counter')).toHaveText('1/40');
    await expect(page.locator('.gd-search-highlight')).toHaveCount(1);

    // Переход «Далее» подсвечивает следующее совпадение (не EditorSelection —
    // поиск не должен красть фокус или открывать flyout типа сигнала) и
    // двигает счётчик, фокус остаётся в поле.
    await page.getByRole('button', { name: 'Следующее совпадение' }).click();
    await expect(page.locator('.book__search-counter')).toHaveText('2/40');
    await expect(page.locator('.gd-search-highlight')).toHaveCount(1);
    await expect(page.locator('.cm-selectionLayer .cm-selectionBackground')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Тип сигнала' })).toHaveCount(0);

    // «Предыдущее» идёт назад и замыкает кольцо (1/40 → 40/40).
    await page.getByRole('button', { name: 'Предыдущее совпадение' }).click();
    await expect(page.locator('.book__search-counter')).toHaveText('1/40');
    await page.getByRole('button', { name: 'Предыдущее совпадение' }).click();
    await expect(page.locator('.book__search-counter')).toHaveText('40/40');

    // Результаты обновляются при смене ревизии снимка: ввод слова в редакторе
    // добавляет совпадение (41-е) после ack команды; активный номер остаётся
    // на своём месте (40-е из 41).
    await page.locator('.cm-content').click();
    await page.keyboard.type('кот ');
    await expect(page.locator('.book__search-counter')).toHaveText('40/41');
  } finally {
    await closeApp(session);
  }
});

test('область поиска зависит от вида: «Текст» ищет снимок, «Исходник» — raw Markdown', async () => {
  const chapterText = '# Заголовок\n\nкот спит на подоконнике.\n';
  const session = await launchWithBook({ 'Глава 1.md': chapterText });
  const { page, bookRoot, userData, openByDialog } = session;
  await openByDialog();
  await expect(page.getByRole('button', { name: 'Заголовок' })).toBeVisible();
  await closeApp(session);
  // Активная правка кот → кит-кот: производный текст содержит «кит», исходник нет.
  await writeEditSidecar(bookRoot, 'Глава 1.md', chapterText, 'кот', 'кит-кот');

  const { app, page: page2 } = await relaunch(userData);
  try {
    await page2.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page2.getByRole('button', { name: 'Заголовок' }).click();
    await expect(page2.locator('.cm-content')).toBeVisible();

    // В «Тексте» (snapshot.text) применённая правка видна: «кит» найден.
    await page2.keyboard.press('Control+f');
    await page2.getByRole('textbox', { name: 'Поиск по главе' }).fill('кит');
    await expect(page2.locator('.book__search-counter')).toHaveText('1/1');
    await page2.getByRole('button', { name: 'Следующее совпадение' }).click();

    // В «Исходнике» (snapshot.sourceText) той подстроки нет: область другая.
    await page2.getByRole('button', { name: 'Исходник' }).click();
    await expect(page2.getByRole('search', { name: 'Поиск по главе (Исходник)' })).toBeVisible();
    await expect(page2.locator('.book__search-counter')).toHaveText('нет совпадений');
    // А исходная подстрока «кот» в raw Markdown находится.
    await page2.getByRole('textbox', { name: 'Поиск по главе' }).fill('кот');
    await expect(page2.locator('.book__search-counter')).toHaveText('1/1');

    // Переход выделяет совпадение в read-only исходнике.
    await page2.getByRole('button', { name: 'Следующее совпадение' }).click();
    const selected = await page2.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected).toBe('кот');
  } finally {
    await app.close();
  }
});

test('в «Сравнении» находка во введённой части переводится через координаты сегментов', async () => {
  const chapterText = '# Заголовок\n\nкот спит на подоконнике.\n\n'.repeat(60);
  const session = await launchWithBook({ 'Глава 1.md': chapterText });
  const { page, bookRoot, userData, openByDialog } = session;
  await openByDialog();
  await expect(page.getByRole('button', { name: 'Заголовок' })).toBeVisible();
  await closeApp(session);
  // Sidecar появляется после первого открытия (манифест уже создан).
  await writeEditSidecar(bookRoot, 'Глава 1.md', chapterText, 'кот спит', 'кот-кит спит');

  // Повторный запуск: книга из недавних, правка активна.
  const { app, page: page2 } = await relaunch(userData);
  try {
    await page2.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page2.getByRole('button', { name: 'Заголовок' }).click();
    await expect(page2.locator('.cm-content')).toBeVisible();

    await page2.getByRole('button', { name: 'Сравнение' }).click();
    const comparison = page2.locator('.book__comparison');
    await expect(comparison).toContainText('кот-кит спит');

    // Запрос «кит» существует только во введённой части правки: переход
    // выделяет именно её (display-координаты через сегменты), а не удалённую.
    await page2.keyboard.press('Control+f');
    await page2.getByRole('textbox', { name: 'Поиск по главе' }).fill('кит');
    await expect(page2.locator('.book__search-counter')).toHaveText('1/1');
    await page2.getByRole('button', { name: 'Следующее совпадение' }).click();
    const selected = await page2.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected).toBe('кит');
  } finally {
    await app.close();
  }
});

test('фильтр глав скрывает лишние записи и не меняет манифест', async () => {
  const session = await launchWithBook({
    'Медведь.md': 'текст\n',
    'Кит.md': 'текст\n',
    'Ёж.md': 'текст\n',
    '012-без-заголовка.md': 'текст без заголовка\n',
    'medved-fish.md': '# Заголовок\n\nтекст\n',
  });
  const { page, bookRoot, openByDialog } = session;
  try {
    await openByDialog();
    await expect(page.getByRole('button', { name: 'Медведь' })).toBeVisible();
    const manifestPath = path.join(bookRoot, '.pocket-editor.json');
    const before = await readFile(manifestPath, 'utf8');

    await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('кит');
    await expect(page.getByRole('button', { name: 'Кит' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Медведь' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ёж' })).toHaveCount(0);
    await expect(page.getByText('Главы не найдены')).toHaveCount(0);

    // Регистр не важен (история №9).
    await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('КИТ');
    await expect(page.getByRole('button', { name: 'Кит' })).toBeVisible();

    // Без заголовка отображается по пути (`entry.title === ''` → title || path);
    // фильтр находит её и по числовому фрагменту пути «012», не только по названию.
    await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('012');
    await expect(page.getByRole('button', { name: '012-без-заголовка.md' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Медведь' })).toHaveCount(0);

    // Совпадение по пути, а не только по названию: файл «medved-fish.md»
    // отображается под названием «Заголовок» (h1), но фильтр всё равно
    // находит его по латинскому пути, которого нет в названии.
    await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('medved');
    await expect(page.getByRole('button', { name: 'Заголовок' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Кит' })).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('выдра');
    await expect(page.getByText('Главы не найдены')).toBeVisible();

    // Пустой фильтр возвращает все главы.
    await page.getByRole('textbox', { name: 'Фильтр глав' }).fill('');
    await expect(page.getByRole('button', { name: 'Медведь' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Кит' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ёж' })).toBeVisible();

    // Манифест на диске не менялся: фильтр живёт только в отображении.
    expect(await readFile(manifestPath, 'utf8')).toBe(before);
  } finally {
    await closeApp(session);
  }
});

test('оформление: тема красит контейнер, настройки сохраняются в appData, границы в main', async () => {
  const session = await launchWithBook({ 'Глава 1.md': 'текст\n' });
  const { page, userData, openByDialog } = session;
  try {
    await openByDialog();
    await expect(page.getByRole('button', { name: 'Глава 1' })).toBeVisible();

    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Оформление' }).click();
    const themeSelect = page.getByLabel('Тема');
    await expect(themeSelect).toBeVisible();

    const bgBefore = await page.evaluate(
      () => getComputedStyle(document.querySelector('.book')!).getPropertyValue('--app-bg').trim(),
    );
    await themeSelect.selectOption('gruvbox-dark');
    const bgAfter = await page.evaluate(
      () => getComputedStyle(document.querySelector('.book')!).getPropertyValue('--app-bg').trim(),
    );
    expect(bgAfter).not.toBe(bgBefore);
    // Схема темы доезжает до контейнера (color-scheme).
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.querySelector('.book')!).getPropertyValue('color-scheme').trim()),
      )
      .toBe('dark');

    // Размер шрифта: значение уходит и в контейнер, и в appData.
    await page.getByLabel('Размер шрифта книги (10–48)').fill('20');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')!).fontSize))
      .toBe('20px');
    await expect
      .poll(async () => {
        const raw = await readFile(path.join(userData, 'settings.json'), 'utf8');
        const appearance = (JSON.parse(raw) as { appearance: { themeId: string; fontSize: number; fontFamily: string; lineWidth: number } }).appearance;
        return { themeId: appearance.themeId, fontSize: appearance.fontSize };
      })
      .toEqual({ themeId: 'gruvbox-dark', fontSize: 20 });

    // The passive editor preview uses interface typography, independently of book text.
    await page.getByLabel('Шрифт интерфейса', { exact: true }).fill('Georgia');
    await page.getByLabel('Размер интерфейса (10–24)').fill('18');
    await page.getByRole('button', { name: 'Закрыть оформление' }).click();
    const content = page.locator('.cm-content');
    await content.click({ position: { x: 5, y: 8 } });
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.type('правка');
    await expect(content).toContainText('правка');
    await page.keyboard.press('ArrowLeft');
    const preview = page.getByRole('tooltip', { name: 'До правки' });
    await expect(preview).toContainText('текст');
    await expect(preview).toHaveCSS('font-size', '18px');
    await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Georgia');
    await expect(content).toHaveCSS('font-size', '20px');
    await expect(content).toBeFocused();

    // Границы проверяет main: неизвестная тема и fontSize вне 10–48 отвергаются.
    const unknownTheme = await page.evaluate(async () => {
      try {
        await window.desk.setAppearance({ themeId: 'night', fontFamily: 'Lora', fontSize: 16, lineWidth: 720 });
        return 'accepted';
      } catch (cause) {
        return (cause as Error).message;
      }
    });
    expect(unknownTheme).toContain('темы');
    const outOfBounds = await page.evaluate(async () => {
      try {
        await window.desk.setAppearance({ themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 999, lineWidth: 720 });
        return 'accepted';
      } catch (cause) {
        return (cause as Error).message;
      }
    });
    expect(outOfBounds).toContain('Размер шрифта');
  } finally {
    await closeApp(session);
  }
});

test('Zen: панели и topbar скрыты; Escape закрывает popup, но никогда не переключает Zen -- выход только кнопкой, меню или shortcut', async () => {
  const chapterText = '# Заголовок\n\nкот спит на подоконнике.\n';
  const session = await launchWithBook({ 'Глава 1.md': chapterText });
  const { page, bookRoot, userData, openByDialog } = session;
  await openByDialog();
  await expect(page.getByRole('button', { name: 'Заголовок' })).toBeVisible();
  await closeApp(session);
  await writeEditSidecar(bookRoot, 'Глава 1.md', chapterText, 'кот спит', 'кит спит');

  // Ctrl+Alt+Z (Linux/Windows) / Cmd+Alt+Z (macOS) -- см. shortcuts.ts.
  const zenShortcut = process.platform === 'darwin' ? 'Meta+Alt+z' : 'Control+Alt+z';

  const { app, page: zenPage } = await relaunch(userData);
  try {
    await zenPage.getByRole('button', { name: 'Открыть', exact: true }).click();
    await zenPage.getByRole('button', { name: 'Заголовок' }).click();
    await expect(zenPage.locator('.cm-content')).toBeVisible();

    // Вход в Zen: topbar/панели скрыты, выход виден всегда.
    await zenPage.getByRole('button', { name: 'Режим Zen', exact: true }).click();
    await expect(zenPage.locator('.book__header')).toHaveCount(0);
    await expect(zenPage.getByRole('navigation', { name: 'Оглавление' })).toHaveCount(0);
    await expect(zenPage.getByRole('complementary', { name: 'Рецензия' })).toHaveCount(0);
    await expect(zenPage.locator('.book__zen-exit')).toBeVisible();
    await expect(zenPage.locator('.book--zen')).toBeVisible();
    await expect(zenPage.locator('.cm-content')).toBeVisible();

    // Escape дважды без открытых слоёв не выходит из Zen -- Zen никогда не
    // переключается Escape (история №6 / task 7).
    await zenPage.keyboard.press('Escape');
    await zenPage.keyboard.press('Escape');
    await expect(zenPage.locator('.book--zen')).toBeVisible();

    // Попап открывается и в Zen (клик по маркеру правки в тексте).
    await zenPage.getByRole('button', { name: 'Правка', exact: true }).first().click();
    const dialog = zenPage.getByRole('dialog', { name: 'Правка' });
    await expect(dialog).toBeVisible();

    // Escape закрывает попап, Zen остаётся; ещё один Escape тоже не выходит.
    await zenPage.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(zenPage.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
    await expect(zenPage.locator('.book--zen')).toBeVisible();
    await zenPage.keyboard.press('Escape');
    await expect(zenPage.locator('.book--zen')).toBeVisible();
    await expect(zenPage.locator('.book__header')).toHaveCount(0);

    // Постоянная кнопка выхода работает (тот же toggle, что и вход).
    await zenPage.getByRole('button', { name: 'Выйти из Zen' }).click();
    await expect(zenPage.locator('.book__header')).toBeVisible();

    // Shortcut переключает Zen туда и обратно, независимо от Escape.
    await zenPage.keyboard.press(zenShortcut);
    await expect(zenPage.locator('.book--zen')).toBeVisible();
    await zenPage.keyboard.press(zenShortcut);
    await expect(zenPage.locator('.book__header')).toBeVisible();

    // Пункт меню тоже переключает Zen через тот же toggle.
    await zenPage.getByRole('button', { name: 'Меню книги' }).click();
    await zenPage.locator('.book__menu-items').getByRole('button', { name: 'Режим Zen', exact: true }).click();
    await expect(zenPage.locator('.book--zen')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('поиск открывается с клавиатуры и Escape очищает запрос до закрытия', async () => {
  const session = await launchWithBook({ 'Глава.md': 'кот спит\n' });
  try {
    await session.openByDialog();
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();
    const field = page.getByRole('textbox', { name: 'Поиск по главе' });
    await expect(field).toHaveCount(0);
    await page.keyboard.press('Control+f');
    await expect(field).toBeFocused();
    await field.fill('кот');
    // Первая находка сразу подсвечена (история №8), фокус остаётся в поле.
    await expect(page.locator('.gd-search-highlight')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    // Пустой запрос снимает подсветку, не трогая ничего другого в редакторе.
    await expect(page.locator('.gd-search-highlight')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Поиск по главе', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await expect(page.getByRole('button', { name: 'Управление книгой', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Оформление', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Меню книги' })).toBeFocused();
  } finally { await closeApp(session); }
});

test('размер книги не меняет интерфейс; оба локальных шрифта доступны с кириллицей', async () => {
  const session = await launchWithBook({ 'Глава.md': 'Кириллица: ёж и щука.\n' });
  try {
    await session.openByDialog();
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.getByLabel('Размер шрифта книги (10–48)').fill('26');
    await expect(page.locator('.cm-content')).toHaveCSS('font-size', '26px');
    await expect(page.locator('.book')).toHaveCSS('font-size', '13px');
    await page.getByLabel('Размер интерфейса (10–24)').fill('15');
    await expect(page.locator('.book')).toHaveCSS('font-size', '15px');
    await expect(page.locator('.cm-content')).toHaveCSS('font-size', '26px');
    const loaded = await page.evaluate(async () => {
      const ui = await document.fonts.load('13px Geist', 'Ёж');
      const book = await document.fonts.load('18px Literata', 'Щука');
      return [ui.length > 0, book.length > 0];
    });
    expect(loaded).toEqual([true, true]);
  } finally { await closeApp(session); }
});


test('Escape на кнопках поиска очищает запрос и закрывает поиск, но не выходит из Zen', async () => {
  const session = await launchWithBook({ 'Глава.md': 'кот спит\n' });
  try {
    await session.openByDialog();
    const { page } = session;
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.getByRole('button', { name: 'Режим Zen', exact: true }).click();
    await page.keyboard.press('Control+f');
    const field = page.getByRole('textbox', { name: 'Поиск по главе' });
    await field.fill('кот');
    await page.getByRole('button', { name: 'Следующее совпадение' }).focus();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await page.getByRole('button', { name: 'Закрыть поиск' }).focus();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(page.locator('.book__zen-exit')).toBeVisible();
    // Дальнейший Escape не выходит из Zen -- переключение отделено от Escape;
    // выход только явным toggle (кнопка/меню/shortcut, см. предыдущий тест).
    await page.keyboard.press('Escape');
    await expect(page.locator('.book--zen')).toBeVisible();
    await expect(page.locator('.book__zen-exit')).toBeVisible();
  } finally { await closeApp(session); }
});
