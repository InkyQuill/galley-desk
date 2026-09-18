import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { encodeReview, makeAnchor } from '@galley-desk/pocket-format';

const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const tempDirs: string[] = [];

/** Позиция подстроки в байтах (Uint8Array.indexOf ищет поэлементно). */
function byteIndexOf(haystack: Uint8Array, needle: string): number {
  const pattern = new TextEncoder().encode(needle);
  outer: for (let start = 0; start + pattern.length <= haystack.length; start++) {
    for (let index = 0; index < pattern.length; index++) {
      if (haystack[start + index] !== pattern[index]) continue outer;
    }
    return start;
  }
  throw new Error(`Подстрока не найдена: ${needle}`);
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

/** Отдельные temp book и temp userData на каждый тест. */
async function launch(
  bookRoot: string,
  files: Record<string, Buffer | string> = {},
  explicitUserData?: string,
): Promise<Session> {
  const userData = explicitUserData ?? (await makeTempDir('galley-userdata-'));
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

async function closeApp(session: Session): Promise<void> {
  await session.app.close();
}

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('открывает папку без манифеста, создаёт совместимый манифест без рекурсивного обхода', async () => {
  const bookRoot = await makeTempDir('galley-e2e-book-');
  const session = await launch(bookRoot, {
    'Глава 1.md': '# Одна\n\nтекст\n',
    'Глава 2.md': '# Две\n\nдругой текст\n',
    'вложенная/глубокая.md': '# Нет\n',
  });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();

    // Главы верхнего уровня открыты, вложенные не найдены (no recursive discovery).
    await expect(session.page.getByRole('button', { name: 'Одна', exact: true })).toBeVisible();
    await expect(session.page.getByRole('button', { name: 'Две', exact: true })).toBeVisible();
    await expect(session.page.getByRole('button', { name: 'глубокая' })).toHaveCount(0);

    // Совместимый манифест создан на диске.
    const manifest = JSON.parse(await readFile(path.join(bookRoot, '.pocket-editor.json'), 'utf8')) as {
      schema_version: number;
      book_id: string;
      chapters: Array<{ path: string }>;
    };
    expect(manifest.schema_version).toBe(1);
    expect(typeof manifest.book_id).toBe('string');
    expect(manifest.chapters.map((chapter) => chapter.path).sort()).toEqual(['Глава 1.md', 'Глава 2.md']);
  } finally {
    await closeApp(session);
  }
});

test('отмена выбора папки оставляет экран недавних', async () => {
  const bookRoot = await makeTempDir('galley-e2e-cancel-');
  await writeFile(path.join(bookRoot, 'Глава.md'), 'текст\n');
  const session = await launch(bookRoot);
  try {
    await stubDialog(session.app, { canceled: true, filePaths: [] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    // Ни манифеста, ни записей недавних не появилось.
    expect(existsSync(path.join(bookRoot, '.pocket-editor.json'))).toBe(false);
    await expect(session.page.locator('.recent-list')).toHaveCount(0);
  } finally {
    await closeApp(session);
  }
});

test('открывает главу: правка из sidecar, локальная картинка видна, executable URL отвергается', async () => {
  const bookRoot = await makeTempDir('galley-e2e-image-');
  const chapterText = '![рисунок](img.png)\n\nкот спит.\n\n![чужая](file:///etc/passwd)\n';
  const userData = await makeTempDir('galley-userdata-');
  const session = await launch(
    bookRoot,
    {
      'Глава.md': chapterText,
      'img.png': ONE_PX_PNG,
    },
    userData,
  );
  try {
    // Первое открытие создаёт манифест с устойчивыми id глав.
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('button', { name: 'Глава', exact: true })).toBeVisible();
    await closeApp(session);

    // Sidecar с настоящим makeAnchor: правка кот → кит.
    const manifest = JSON.parse(await readFile(path.join(bookRoot, '.pocket-editor.json'), 'utf8')) as {
      book_id: string;
      chapters: Array<{ id: string; path: string }>;
    };
    const chapter = manifest.chapters.find((entry) => entry.path === 'Глава.md')!;
    const bytes = new TextEncoder().encode(chapterText);
    const from = byteIndexOf(bytes, 'кот спит');
    const review = {
      schema_version: 1 as const,
      chapter_id: chapter.id,
      source_path: 'Глава.md',
      chapter_note: '',
      edits: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          before: 'кот спит',
          after: 'кит спит',
          anchor: makeAnchor(bytes, { from, to: from + 15 }),
        },
      ],
      signals: [],
    };
    await writeFile(path.join(bookRoot, 'Глава.review.json'), encodeReview(review), 'utf8');

    // Повторный запуск с тем же профилем: книга открывается из недавних.
    const reopened = await launch(bookRoot, {}, userData);
    try {
      await reopened.page.getByRole('button', { name: 'Открыть', exact: true }).click();
      await reopened.page.getByRole('button', { name: 'Глава', exact: true }).click();
      await expect(reopened.page.locator('.book__text')).toContainText('кит спит.');
      // Исходный файл не изменён: правка живёт в sidecar.
      expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe(chapterText);
      await expect(reopened.page.getByRole('button', { name: 'Правка: кот спит → кит спит', exact: false })).toBeVisible();

      // Курсор уводится с картинки: в live-режиме Galley прячет виджет под
      // курсором. Локальная картинка отображается через защищённую схему.
      await reopened.page.locator('.cm-content').click();
      // Подсказка изображения — общий Tooltip (Task 10), не нативный title;
      // элемент ищем по alt (устойчивый идентификатор картинки в тексте).
      const image = reopened.page.locator('img.book__image[alt="рисунок"]');
      await expect(image).toHaveCount(1);
      await expect(image).toHaveAttribute('src', new RegExp(`^bookres://${manifest.book_id}/img\\.png$`));
      expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      await image.hover();
      await expect(reopened.page.getByRole('tooltip')).toHaveText('img.png');

      // Исполнимые и внешние URL не превращаются в bookres-ссылки.
      await expect(reopened.page.locator('img.book__image[alt="чужая"]')).toHaveCount(0);
      const traversal = await reopened.page.evaluate(async (bookId) => {
        const response = await fetch(`bookres://${bookId}/..%2F..%2Fetc%2Fpasswd`);
        return response.status;
      }, manifest.book_id);
      expect([403, 404]).toContain(traversal);
      const external = await reopened.page.evaluate(async (bookId) => {
        const response = await fetch(`bookres://${bookId}/..%2Fimg%2Epng`);
        return response.status;
      }, manifest.book_id);
      expect([403, 404]).toContain(external);
    } finally {
      await closeApp(reopened);
    }
  } finally {
    if (existsSync(bookRoot)) await rm(bookRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('восстанавливает главу и прокрутку в живом окне и после перезапуска', async () => {
  const bookRoot = await makeTempDir('galley-e2e-restore-');
  const lines = Array.from({ length: 200 }, (_, index) => `строка ${index + 1}`).join('\n');
  const session = await launch(bookRoot, {
    'Глава 1.md': `${lines}\n`,
    'Глава 2.md': `${lines}\n`,
  });
  const running: ElectronApplication[] = [session.app];
  // Скроллер находится внутри редактора: CodeMirror виртуализирует строки
  // и сам ведёт прокрутку длинного документа.
  const scroller = session.page.locator('.book__text .cm-scroller');
  const scrollToEnd = (locator: ReturnType<Page['locator']>): Promise<void> =>
    locator.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('button', { name: 'Глава 1', exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Глава 2', exact: true }).click();
    await expect(scroller).toBeVisible();
    // Прокрутка к концу рендерит хвост виртуализованного документа.
    await scrollToEnd(scroller);
    await expect(scroller).toContainText('строка 200');
    await scroller.evaluate((element) => {
      element.scrollTop = 120;
    });
    // Дожидаемся сохранения позиции (debounce 200 мс) и закрываем книгу.
    await session.page.waitForTimeout(700);
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    const recentsFile = JSON.parse(
      await readFile(path.join(session.userData, 'recent-books.json'), 'utf8'),
    ) as Array<{ lastChapterId: string | null; scrollTop: number | null; bookId: string }>;
    expect(recentsFile).toHaveLength(1);
    expect(recentsFile[0]!.scrollTop).toBe(120);
    expect(recentsFile[0]!.lastChapterId).not.toBeNull();

    // Повторное открытие в том же окне возвращает главу и прокрутку.
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.book__chapter-row--active').getByRole('button', { name: 'Глава 2', exact: true })).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(120);
    // Прокрутка к концу снова рендерит хвост: содержимое на месте.
    await scrollToEnd(scroller);
    await expect(scroller).toContainText('строка 200');
    // Вернём проверяемую позицию перед завершением процесса: закрытие теперь
    // корректно сохраняет последний viewport-anchor и иначе зафиксирует конец.
    await scroller.evaluate((element) => { element.scrollTop = 120; });
    await session.page.waitForTimeout(700);
    const restartAnchorLine = await scroller.locator('.cm-line').evaluateAll((lines) => {
      const top = document.querySelector('.book__text .cm-scroller')!.getBoundingClientRect().top;
      return lines.find(line => line.getBoundingClientRect().bottom > top)?.textContent ?? null;
    });
    expect(restartAnchorLine).not.toBeNull();

    const settingsFile = JSON.parse(
      await readFile(path.join(session.userData, 'settings.json'), 'utf8'),
    ) as { positions: Record<string, Record<string, { anchor: number; scrollTop: number }>> };
    const bookPositions = settingsFile.positions[recentsFile[0]!.bookId]!;
    const chapterPosition = Object.values(bookPositions).find((position) => position.scrollTop === 120);
    expect(chapterPosition).toBeDefined();

    // Полный перезапуск приложения в том же профиле: глава и прокрутка
    // восстанавливаются из записи недавних, без внутрисессионного кэша.
    running.splice(running.indexOf(session.app), 1);
    await closeApp(session);
    const restarted = await launch(bookRoot, {}, session.userData);
    running.push(restarted.app);
    await expect(restarted.page.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible();
    await restarted.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(restarted.page.locator('.book__chapter-row--active').getByRole('button', { name: 'Глава 2', exact: true })).toBeVisible();
    const restartedScroller = restarted.page.locator('.book__text .cm-scroller');
    await expect
      .poll(() => restartedScroller.locator('.cm-line').evaluateAll((lines) => {
        const top = document.querySelector('.book__text .cm-scroller')!.getBoundingClientRect().top;
        return lines.find(line => line.getBoundingClientRect().bottom > top)?.textContent ?? null;
      }))
      .toBe(restartAnchorLine);
    const restartedTop = await restartedScroller.evaluate((element) => element.scrollTop);
    expect(Math.abs(restartedTop - 120)).toBeLessThanOrEqual(31);
    await scrollToEnd(restartedScroller);
    await expect(restartedScroller).toContainText('строка 200');
  } finally {
    await Promise.all(running.map((app) => app.close().catch(() => undefined)));
  }
});

test('выбор той же папки диалогом восстанавливает главу и прокрутку так же, как открытие через «Недавние» (история №1)', async () => {
  const bookRoot = await makeTempDir('galley-e2e-dialog-restore-');
  const lines = Array.from({ length: 200 }, (_, index) => `строка ${index + 1}`).join('\n');
  const session = await launch(bookRoot, {
    'Глава 1.md': `${lines}\n`,
    'Глава 2.md': `${lines}\n`,
  });
  const scroller = session.page.locator('.book__text .cm-scroller');
  const scrollToEnd = (locator: ReturnType<Page['locator']>): Promise<void> =>
    locator.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('button', { name: 'Глава 1', exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Глава 2', exact: true }).click();
    await expect(scroller).toBeVisible();
    await scrollToEnd(scroller);
    await expect(scroller).toContainText('строка 200');
    await scroller.evaluate((element) => {
      element.scrollTop = 120;
    });
    await session.page.waitForTimeout(700);
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    // Тот же путь снова выбирается через dialog (а не через кнопку «Открыть»
    // списка недавних) — восстановление должно быть тем же самым, потому что
    // сопоставление идёт по bookId, который main уже сохранил в recent.
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.locator('.book__chapter-row--active').getByRole('button', { name: 'Глава 2', exact: true })).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(120);
  } finally {
    await closeApp(session);
  }
});

test('отмена диалога после уже сохранённой позиции не меняет экран недавних', async () => {
  const bookRoot = await makeTempDir('galley-e2e-dialog-cancel-');
  const session = await launch(bookRoot, { 'Глава.md': 'текст\n' });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('button', { name: 'Глава', exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    // Пользователь снова жмёт «Открыть папку…», но отменяет диалог: список
    // недавних остаётся как был, книга не открывается, восстановление не
    // запускается.
    await stubDialog(session.app, { canceled: true, filePaths: [] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('heading', { name: 'Galley Desk' })).toBeVisible();
    await expect(session.page.locator('.recent-list__item')).toHaveCount(1);
  } finally {
    await closeApp(session);
  }
});

test('папка, переехавшая на новое место, восстанавливает позицию через диалог по bookId', async () => {
  const bookRoot = await makeTempDir('galley-e2e-dialog-moved-');
  const movedRoot = `${bookRoot}-переехала`;
  const lines = Array.from({ length: 200 }, (_, index) => `строка ${index + 1}`).join('\n');
  const session = await launch(bookRoot, {
    'Глава 1.md': `${lines}\n`,
    'Глава 2.md': `${lines}\n`,
  });
  const scroller = session.page.locator('.book__text .cm-scroller');
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await session.page.getByRole('button', { name: 'Глава 2', exact: true }).click();
    await expect(scroller).toBeVisible();
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await scroller.evaluate((element) => {
      element.scrollTop = 80;
    });
    await session.page.waitForTimeout(700);
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    await rename(bookRoot, movedRoot);

    // Диалог теперь указывает на новое расположение; главу и прокрутку
    // находим по bookId, а не по (уже неверному) старому пути.
    await stubDialog(session.app, { canceled: false, filePaths: [movedRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.locator('.book__chapter-row--active').getByRole('button', { name: 'Глава 2', exact: true })).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBe(80);
  } finally {
    if (existsSync(bookRoot)) await rm(bookRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(movedRoot, { recursive: true, force: true }).catch(() => undefined);
    await closeApp(session);
  }
});

test('глава, исчезнувшая из оглавления, не восстанавливается через диалог — открывается первая доступная', async () => {
  const bookRoot = await makeTempDir('galley-e2e-dialog-missing-chapter-');
  const session = await launch(bookRoot, {
    'Глава 1.md': 'первая\n',
    'Глава 2.md': 'вторая\n',
  });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await session.page.getByRole('button', { name: 'Глава 2', exact: true }).click();
    await expect(session.page.locator('.book__text')).toContainText('вторая');
    await session.page.waitForTimeout(700);
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    // Последняя открытая глава (Глава 2) исчезает с диска — манифест её
    // теперь помечает missing; восстановление обязано это заметить.
    await rm(path.join(bookRoot, 'Глава 2.md'));

    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.locator('.book__chapter-row--active').getByRole('button', { name: 'Глава 1', exact: true })).toBeVisible();
    await expect(session.page.locator('.book__text')).toContainText('первая');
  } finally {
    await closeApp(session);
  }
});

test('книга без доступных глав открывается без восстановления и без падения — что через диалог, что через «Недавние»', async () => {
  const bookRoot = await makeTempDir('galley-e2e-no-chapters-');
  // Ни одного .md файла верхнего уровня — discover() даёт пустой список глав,
  // манифест создаётся с chapters: [] (packages/book-storage/src/book.ts).
  const session = await launch(bookRoot, { 'заметка.txt': 'не глава\n' });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();

    // Окно книги открылось (заголовок виден), но глав для выбора нет и
    // восстанавливать нечего — без падения и без ложной активной главы.
    await expect(session.page.locator('.titlebar__title')).toHaveText(path.basename(bookRoot));
    await expect(session.page.getByRole('button', { name: 'Меню книги' })).toBeVisible();
    await expect(session.page.locator('.book__chapter')).toHaveCount(0);
    await expect(session.page.locator('.book__chapter-row--active')).toHaveCount(0);
    await expect(session.page.getByRole('alert')).toHaveCount(0);

    const manifest = JSON.parse(await readFile(path.join(bookRoot, '.pocket-editor.json'), 'utf8')) as {
      chapters: unknown[];
    };
    expect(manifest.chapters).toHaveLength(0);

    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    // Тот же результат через «Недавние»: тоже без падения, без активной главы.
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.locator('.titlebar__title')).toHaveText(path.basename(bookRoot));
    await expect(session.page.locator('.book__chapter')).toHaveCount(0);
    await expect(session.page.getByRole('alert')).toHaveCount(0);
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    // И снова через диалог — тот же результат (dialog/Recent parity —
    // главная мысль истории №1 — держится и на нулевом наборе глав).
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.locator('.titlebar__title')).toHaveText(path.basename(bookRoot));
    await expect(session.page.locator('.book__chapter')).toHaveCount(0);
    await expect(session.page.getByRole('alert')).toHaveCount(0);
  } finally {
    await closeApp(session);
  }
});

test('недоступная папка помечается, забывание сохраняет файлы', async () => {
  const bookRoot = await makeTempDir('galley-e2e-missing-');
  const session = await launch(bookRoot, { 'Глава.md': 'текст\n' });
  let movedRoot = '';
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('button', { name: 'Глава', exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Меню книги' }).click();
    await session.page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();

    movedRoot = `${bookRoot}-переехала`;
    await rename(bookRoot, movedRoot);
    await session.page.reload();

    // Запись сохраняется с пометкой, открытие даёт ошибку.
    await expect(session.page.getByText('папка не найдена')).toBeVisible();
    await session.page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(session.page.getByRole('alert')).toContainText('недоступна');
    await expect(session.page.getByText('папка не найдена')).toBeVisible();

    // Забыть — запись исчезает, файлы остаются.
    await session.page.getByRole('button', { name: 'Забыть' }).click();
    await expect(session.page.locator('.recent-list')).toHaveCount(0);
    expect(existsSync(path.join(movedRoot, '.pocket-editor.json'))).toBe(true);
  } finally {
    await closeApp(session);
  }
});

test('неизвестная версия манифеста не перезаписывается', async () => {
  const bookRoot = await makeTempDir('galley-e2e-unknown-');
  const brokenManifest = JSON.stringify({
    schema_version: 99,
    book_id: '01234567-89ab-4cde-8f01-23456789abcd',
    title: 'Книга',
    chapters: [],
  });
  const session = await launch(bookRoot, {
    'Глава.md': 'текст\n',
    '.pocket-editor.json': brokenManifest,
  });
  try {
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    await expect(session.page.getByRole('alert')).toContainText('cannot be decoded');
    // Экран недавних не сменился, файл манифеста не тронут.
    await expect(session.page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    expect(await readFile(path.join(bookRoot, '.pocket-editor.json'), 'utf8')).toBe(brokenManifest);
    expect(await session.page.evaluate(() => window.desk.recent())).toEqual([]);
    expect(await readFile(path.join(bookRoot, 'Глава.md'), 'utf8')).toBe('текст\n');
  } finally {
    await closeApp(session);
  }
});

test('malformed review is read-only from the first editor frame and preserves files', async () => {
  const bookRoot = await makeTempDir('galley-readonly-');
  const manifest = JSON.stringify({ schema_version: 1, book_id: '99999999-9999-4999-8999-999999999999', title: 'Read only', chapters: [{ id: '11111111-1111-4111-8111-111111111111', path: 'chapter.md', title: 'Chapter' }], ignored_files: [] });
  const files = { '.pocket-editor.json': manifest, 'chapter.md': 'original\r\n', 'chapter.review.json': '{ broken' };
  const session = await launch(bookRoot, files);
  try {
    await session.page.evaluate(() => {
      const state = window as unknown as { editableFrames: string[] };
      state.editableFrames = [];
      new MutationObserver(() => {
        const editor = document.querySelector('.cm-content');
        if (editor) state.editableFrames.push(editor.getAttribute('contenteditable') ?? 'missing');
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
    });
    await stubDialog(session.app, { canceled: false, filePaths: [bookRoot] });
    await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
    const editor = session.page.locator('.cm-content');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await expect(session.page.getByRole('alert')).toContainText('Только чтение');
    await expect(session.page.locator('.book__save-state')).not.toContainText('Сохранено');
    await session.page.getByRole('button', { name: 'Заметка главы', exact: true }).click();
    await expect(session.page.getByRole('textbox', { name: 'Текст заметки' })).toHaveAttribute('readonly', '');
    await expect(session.page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    const frames = await session.page.evaluate(() => (window as unknown as { editableFrames: string[] }).editableFrames);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(value => value === 'false')).toBe(true);
    await session.page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await editor.click();
    await session.page.keyboard.type('attempted mutation');
    for (const [name, bytes] of Object.entries(files)) expect(await readFile(path.join(bookRoot, name), 'utf8')).toBe(bytes);
  } finally { await closeApp(session); }
});
