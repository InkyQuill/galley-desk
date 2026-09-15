import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { encodeReview, makeAnchor } from '../../packages/pocket-format/src/index';
import type { Review } from '../../packages/pocket-format/src/index';
import { applyEdit, openChapter } from '../../packages/review-engine/src/index';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

type Session = { app: ElectronApplication; page: Page; userData: string; bookRoot: string };

/** Отдельные temp book и temp userData на каждый тест (как в open-book.spec). */
async function launch(
  bookRoot: string,
  files: Record<string, Buffer | string> = {},
): Promise<Session> {
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
  // Ошибки основного процесса (стабильные коды) видны в логе теста.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes('[desk]')) process.stdout.write(`[main] ${text}`);
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

async function openOwnBook(session: Session): Promise<void> {
  await stubDialog(session.app, { canceled: false, filePaths: [session.bookRoot] });
  await session.page.getByRole('button', { name: 'Открыть папку…' }).click();
  await expect(session.page.locator('.cm-content')).toBeVisible();
}

/** Дожидается завершения сохранения: sidecar на диске перестаёт меняться. */
async function waitSaveDrained(page: Page, sidecarPath: string): Promise<string> {
  let previous = '';
  try {
    previous = await readFile(sidecarPath, 'utf8');
  } catch {
    previous = '';
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.waitForTimeout(250);
    let current: string;
    try {
      current = await readFile(sidecarPath, 'utf8');
    } catch {
      current = '';
    }
    if (current !== '' && current === previous) return current;
    previous = current;
  }
  throw new Error(`Сохранение не завершилось: ${sidecarPath}`);
}

/** Читает sidecar, пока он не удовлетворит условию; возвращает разобранный JSON. */
async function waitSidecar(
  page: Page,
  sidecarPath: string,
  condition: (review: Review) => boolean,
): Promise<Review> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.waitForTimeout(250);
    try {
      const parsed = JSON.parse(await readFile(sidecarPath, 'utf8')) as Review;
      if (condition(parsed)) return parsed;
    } catch {
      // Файл может ещё не существовать — ждём дальше.
    }
  }
  throw new Error(`sidecar не достиг нужного состояния: ${sidecarPath}`);
}

async function readSidecar(sidecarPath: string): Promise<Review | null> {
  try {
    return JSON.parse(await readFile(sidecarPath, 'utf8')) as Review;
  } catch {
    return null;
  }
}

// --- Фикстура книги -----------------------------------------------------------

const SOURCE_TEXT = 'кот спит.\n';
const CHAPTER_PATH = 'Глава.md';
const SIDECAR_PATH = 'Глава.review.json';
const CHAPTER_ID = randomUUID();
const EDIT_ID = randomUUID();
const SIGNAL_ID = randomUUID();

/** Fixture Pair: правка кот → кит и независимый сигнал после заменённого диапазона. */
function fixtureReview(): Review {
  const source = new TextEncoder().encode(SOURCE_TEXT);
  return {
    schema_version: 1,
    chapter_id: CHAPTER_ID,
    source_path: CHAPTER_PATH,
    chapter_note: '',
    // UTF-8: кириллица по 2 байта — «кот» это 0..6, «спит.» это 7..16.
    edits: [{ id: EDIT_ID, before: 'кот', after: 'кит', anchor: makeAnchor(source, { from: 0, to: 6 }) }],
    signals: [
      {
        id: SIGNAL_ID,
        type: 'note',
        selected_text: 'спит.',
        comment: 'Проверить созвучие',
        anchor: makeAnchor(source, { from: 7, to: 16 }),
      },
    ],
  };
}

/** Пустая рецензия над исходником (для создания записей через UI). */
function emptyReview(): Review {
  return { schema_version: 1, chapter_id: CHAPTER_ID, source_path: CHAPTER_PATH, chapter_note: '', edits: [], signals: [] };
}

/** Рецензия с недоступными записями: якоря сняты над чужими байтами. */
function staleReview(): Review {
  const source = new TextEncoder().encode(SOURCE_TEXT);
  const wrong = new TextEncoder().encode('совсем другой текст\n');
  return {
    schema_version: 1,
    chapter_id: CHAPTER_ID,
    source_path: CHAPTER_PATH,
    chapter_note: '',
    edits: [{ id: randomUUID(), before: 'кот', after: 'кит', anchor: makeAnchor(wrong, { from: 0, to: 6 }) }],
    signals: [
      {
        id: randomUUID(),
        type: 'warning',
        selected_text: 'спит',
        comment: 'Тон',
        anchor: makeAnchor(wrong, { from: 0, to: 6 }),
      },
    ],
  };
}

/** Рецензия с двумя пересекающимися правками — обе становятся конфликтующими. */
function conflictingReview(): Review {
  const source = new TextEncoder().encode(SOURCE_TEXT);
  return {
    schema_version: 1,
    chapter_id: CHAPTER_ID,
    source_path: CHAPTER_PATH,
    chapter_note: '',
    edits: [
      { id: randomUUID(), before: 'кот', after: 'котик', anchor: makeAnchor(source, { from: 0, to: 6 }) },
      { id: randomUUID(), before: 'кот ', after: 'пёс ', anchor: makeAnchor(source, { from: 0, to: 7 }) },
    ],
    signals: [],
  };
}

async function writeBook(bookRoot: string, review: Review): Promise<void> {
  const manifest = {
    schema_version: 1,
    book_id: randomUUID(),
    title: 'Тестовая книга',
    chapters: [{ id: review.chapter_id, path: CHAPTER_PATH, title: 'Глава' }],
    ignored_files: [],
  };
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(bookRoot, CHAPTER_PATH), SOURCE_TEXT, 'utf8');
  await writeFile(path.join(bookRoot, SIDECAR_PATH), encodeReview(review), 'utf8');
}

/** Выделяет length символов с начала документа клавиатурой. */
async function selectFromStart(page: Page, skip: number, length: number): Promise<void> {
  // Клик у левого верхнего угла контента: не задевает виджеты-маркеры.
  await page.locator('.cm-content').click({ position: { x: 5, y: 8 } });
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < skip; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < length; i++) await page.keyboard.press('Shift+ArrowRight');
}

/** Клавиатурный путь выделение → flyout → попап: создаёт сигнал заданного типа. */
async function createSignalByKeyboard(
  page: Page,
  sidecarPath: string,
  selection: { skip: number; length: number },
  type: string,
  comment: string,
): Promise<Review> {
  await selectFromStart(page, selection.skip, selection.length);
  const flyout = page.locator('[data-review-flyout]');
  await expect(flyout).toBeVisible();
  await page.keyboard.press('Tab');
  const firstType = flyout.getByRole('button', { name: 'note', exact: true });
  await expect(firstType).toBeFocused();
  let focused = 'note';
  while (focused !== type) {
    await page.keyboard.press('Tab');
    const labels = ['note', 'change_required', 'warning', 'review'];
    focused = labels[(labels.indexOf(focused) + 1) % labels.length] as string;
  }
  await page.keyboard.press('Enter');
  const textarea = page.getByRole('textbox', { name: 'Комментарий сигнала' });
  await expect(textarea).toBeFocused();
  if (comment !== '') await textarea.fill(comment);
  await textarea.press('Control+Enter');
  return waitSidecar(page, sidecarPath, (review) =>
    review.signals.some((signal) => signal.type === type && signal.comment === comment));
}

test('заметка главы сохраняется в sidecar; при ошибке черновик остаётся', async () => {
  const bookRoot = await makeTempDir('galley-e2e-note-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);

    await page.getByRole('button', { name: 'Заметка главы' }).click();
    const note = page.getByRole('textbox', { name: 'Текст заметки' });
    await note.fill('Глава требует вычитки');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const sidecar = await waitSidecar(page, sidecarPath, (review) => review.chapter_note !== '');
    expect(sidecar.chapter_note).toBe('Глава требует вычитки');

    // Ошибка сохранения: исходник исчезает, черновик заметки не сбрасывается.
    await page.getByRole('button', { name: 'Заметка главы' }).click();
    await note.fill('Глава требует вычитки и правки');
    await rm(path.join(bookRoot, CHAPTER_PATH));
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(note).toHaveValue('Глава требует вычитки и правки');
  } finally {
    await session.app.close();
  }
});

test.afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('применение правки в «Сравнении» пишет обе пары, Отменить/Повторить восстанавливают байты', async () => {
  const review = fixtureReview();
  const source = new TextEncoder().encode(SOURCE_TEXT);
  const applied = applyEdit(openChapter(source, review), EDIT_ID);
  const bookRoot = await makeTempDir('galley-e2e-review-');
  await writeBook(bookRoot, review);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const mdPath = path.join(bookRoot, CHAPTER_PATH);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
    // До применения на диске ровно fixture-пара.
    expect(await readFile(mdPath, 'utf8')).toBe(SOURCE_TEXT);
    expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(review));

    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.locator('.book__comparison')).toContainText('кит');
    await page.getByRole('button', { name: 'Правка', exact: true }).first().click();
    const applyButton = page.getByRole('button', { name: 'Применить', exact: true });
    await expect(applyButton).toBeVisible();
    await applyButton.click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();
    // Обе реальные файлы равны применённой паре: правка ушла из sidecar,
    // независимый сигнал после заменённого диапазона перенесён якорем движка.
    const appliedText = new TextDecoder().decode(applied.source);
    expect(await readFile(mdPath, 'utf8')).toBe(appliedText);
    expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(applied.review));
    const appliedSidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as Review;
    expect(appliedSidecar.edits).toHaveLength(0);
    expect(appliedSidecar.signals).toHaveLength(1);

    await page.getByRole('button', { name: 'Отменить применение' }).click();
    await expect(page.getByRole('button', { name: 'Повторить применение' })).toBeEnabled();
    expect(await readFile(mdPath, 'utf8')).toBe(SOURCE_TEXT);
    expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(review));

    await page.getByRole('button', { name: 'Повторить применение' }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();
    expect(await readFile(mdPath, 'utf8')).toBe(appliedText);
    expect(await readFile(sidecarPath, 'utf8')).toBe(encodeReview(applied.review));
  } finally {
    await session.app.close();
  }
});

test('клавиатурный путь выделение → flyout → попап создаёт сигнал с комментарием', async () => {
  const bookRoot = await makeTempDir('galley-e2e-signal-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
    const content = page.locator('.cm-content');

    await selectFromStart(page, 0, 3);
    const flyout = page.locator('[data-review-flyout]');
    await expect(flyout).toBeVisible();
    // Flyout не переносит фокус: копирование и навигация остаются в редакторе.
    await expect(content).toBeFocused();

    const sidecar = await createSignalByKeyboard(page, sidecarPath, { skip: 0, length: 3 }, 'note', 'Обсудить');
    const signal = sidecar.signals.find((candidate) => candidate.comment === 'Обсудить');
    expect(signal?.type).toBe('note');
    expect(signal?.selected_text).toBe('кот');
    // Маркер сигнала в «Тексте» и подстрока комментария под диапазоном.
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toBeVisible();
    const comment = page.locator('.gd-signal-comment');
    await expect(comment).toHaveText('Обсудить');
    expect(await comment.getAttribute('contenteditable')).toBe('false');
  } finally {
    await session.app.close();
  }
});

test('Esc закрывает попап без создания сигнала и возвращает фокус в редактор', async () => {
  const bookRoot = await makeTempDir('galley-e2e-esc-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
    const content = page.locator('.cm-content');

    await selectFromStart(page, 4, 4);
    await expect(page.locator('[data-review-flyout]')).toBeVisible();
    await page.keyboard.press('Tab'); // note
    await page.keyboard.press('Tab'); // change_required
    await page.keyboard.press('Tab'); // warning
    await page.keyboard.press('Enter');
    const textarea = page.getByRole('textbox', { name: 'Комментарий сигнала' });
    await expect(textarea).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Новый сигнал' })).toHaveCount(0);
    await expect(content).toBeFocused();

    // Пустой сигнал не создан: sidecar остался без сигналов.
    await waitSaveDrained(page, sidecarPath);
    const sidecar = await readSidecar(sidecarPath);
    expect(sidecar?.signals ?? []).toHaveLength(0);

    // Фокус вернулся в редактор: ввод заменяет выделение как обычно.
    await page.keyboard.type('!');
    await expect(content).toContainText('кот !.\n');
  } finally {
    await session.app.close();
  }
});

test('четыре типа сигналов получают свои цвета flyout; пересекающиеся сигналы независимы', async () => {
  const bookRoot = await makeTempDir('galley-e2e-types-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);

    await selectFromStart(page, 0, 3);
    const flyout = page.locator('[data-review-flyout]');
    await expect(flyout).toBeVisible();
    // Цвета кнопок повторяют ReviewColors из Pocket Editor (светлая тема).
    const expectedColors: Record<string, string> = {
      note: 'rgb(30, 90, 155)',
      change_required: 'rgb(166, 43, 43)',
      warning: 'rgb(121, 89, 0)',
      review: 'rgb(117, 69, 165)',
    };
    for (const [type, rgb] of Object.entries(expectedColors)) {
      expect(
        await flyout
          .getByRole('button', { name: type, exact: true })
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe(rgb);
    }

    // Пустой комментарий допустим; правка существующего сигнала — отдельный тест.
    await createSignalByKeyboard(page, sidecarPath, { skip: 0, length: 3 }, 'note', '');
    // Пересекающийся сигнал на том же диапазоне: оба маркера остаются видимы.
    await createSignalByKeyboard(page, sidecarPath, { skip: 0, length: 3 }, 'change_required', 'Проверить');
    await createSignalByKeyboard(page, sidecarPath, { skip: 4, length: 4 }, 'warning', 'Тон');
    await createSignalByKeyboard(page, sidecarPath, { skip: 8, length: 1 }, 'review', '');
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toHaveCount(4);
    await expect(page.locator('.gd-signal-comment')).toHaveCount(2);

    const sidecar = await readSidecar(sidecarPath);
    const types = sidecar?.signals.map((signal) => signal.type).sort() ?? [];
    expect(types).toEqual(['change_required', 'note', 'review', 'warning']);
    expect(sidecar?.signals.find((signal) => signal.type === 'note')?.comment).toBe('');

    // Удаление: zero-width маркер с доступным названием остаётся видимым.
    await selectFromStart(page, 4, 4);
    await page.keyboard.press('Backspace');
    await expect(page.getByRole('button', { name: 'Удаление: спит' })).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: 'Удаление: спит' })).toHaveCount(0);

    // «Исходник» немаркированный: ни маркеров, ни flyout.
    await page.getByRole('button', { name: 'Исходник', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toHaveCount(0);
    await expect(page.locator('.book__source')).toHaveText(SOURCE_TEXT);
  } finally {
    await session.app.close();
  }
});

test('изменение существующего сигнала заменяет тип и комментарий, не дублируя запись', async () => {
  const bookRoot = await makeTempDir('galley-e2e-resignal-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);

    await createSignalByKeyboard(page, sidecarPath, { skip: 0, length: 3 }, 'note', 'Первый');

    // Клик по молнии открывает тот же попап с типом и комментарием.
    await page.getByRole('button', { name: 'Сигнал', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Сигнал' });
    await expect(dialog).toBeVisible();
    const textarea = dialog.getByRole('textbox', { name: 'Комментарий сигнала' });
    await expect(textarea).toHaveValue('Первый');
    await dialog.getByRole('button', { name: 'review', exact: true }).click();
    await textarea.fill('Второй');
    await textarea.press('Control+Enter');

    const sidecar = await waitSidecar(page, sidecarPath, (review) =>
      review.signals.length === 1 && review.signals[0] !== undefined && review.signals[0].comment === 'Второй');
    expect(sidecar.signals[0]?.type).toBe('review');
    expect(sidecar.signals).toHaveLength(1);
  } finally {
    await session.app.close();
  }
});

test('сигнал на добавленном тексте якорится к исходному диапазону правки', async () => {
  const bookRoot = await makeTempDir('galley-e2e-added-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
    const content = page.locator('.cm-content');

    // Правка кот → котик: заменяющий кусок покрывает исходные байты 0..6.
    await selectFromStart(page, 0, 3);
    await page.keyboard.type('котик');
    await expect(content).toContainText('котик');

    // Сигнал внутри добавленного текста получает исходный якорь правки
    // (какой она ни приобрела после последовательного ввода).
    const sidecar = await createSignalByKeyboard(page, sidecarPath, { skip: 3, length: 2 }, 'review', 'Новое');
    const edit = sidecar.edits[0];
    const signal = sidecar.signals.find((candidate) => candidate.comment === 'Новое');
    expect(signal?.anchor.start_byte).toBe(edit?.anchor.start_byte);
    expect(signal?.anchor.end_byte).toBe(edit?.anchor.end_byte);
    expect(signal?.selected_text).toBe(edit?.before);
    expect(sidecar.edits).toHaveLength(1);
  } finally {
    await session.app.close();
  }
});

test('Отклонить правки сохраняет независимый сигнал; отметки видны в обоих видах', async () => {
  const bookRoot = await makeTempDir('galley-e2e-reject-');
  await writeBook(bookRoot, fixtureReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);

    // Маркер правки в «Тексте» → попап → Отклонить.
    await page.getByRole('button', { name: 'Правка', exact: true }).click();
    await page.getByRole('dialog', { name: 'Правка' }).getByRole('button', { name: 'Отклонить', exact: true }).click();

    const sidecar = await waitSidecar(page, sidecarPath, (review) => review.edits.length === 0);
    expect(sidecar.signals).toHaveLength(1);
    // Правка исчезла из «Текста», независимый сигнал остался.
    await expect(page.getByRole('button', { name: 'Правка', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toBeVisible();
    expect(await readFile(path.join(bookRoot, CHAPTER_PATH), 'utf8')).toBe(SOURCE_TEXT);

    // Обе отметки видны и в «Сравнении»; исходник немаркированный.
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Исходник', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toHaveCount(0);
  } finally {
    await session.app.close();
  }
});

test('недоступные записи открывают карточку в панели с причиной и удалением', async () => {
  const bookRoot = await makeTempDir('galley-e2e-stale-');
  await writeBook(bookRoot, staleReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);

    // Нет маркеров: записи вне производного текста, фиктивного перехода нет.
    await expect(page.getByRole('button', { name: 'Правка', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /^Правка: кот → кит — недоступна/ }).click();
    const card = page.getByRole('dialog', { name: 'Недоступная запись' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('кот → кит');
    await expect(card).toContainText('Причина:');

    // Удаление доступно прямо из карточки; вторая запись не затрагивается.
    await card.getByRole('button', { name: 'Удалить', exact: true }).click();
    const sidecar = await waitSidecar(page, sidecarPath, (review) => review.edits.length === 0);
    expect(sidecar.signals).toHaveLength(1);
    await expect(page.getByRole('dialog', { name: 'Недоступная запись' })).toHaveCount(0);
  } finally {
    await session.app.close();
  }
});

test('конфликтующие правки исключены из текста; удаление участника возвращает другую', async () => {
  const bookRoot = await makeTempDir('galley-e2e-conflict-');
  await writeBook(bookRoot, conflictingReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
    const content = page.locator('.cm-content');

    // Обе конфликтуют: производный текст равен исходнику, маркеров нет.
    await expect(content).toContainText('кот спит.');
    await expect(page.getByRole('button', { name: /^Правка: .* — конфликтует/ })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Правка', exact: true })).toHaveCount(0);

    // Карточка конфликтующей записи открывается в панели.
    await page.getByRole('button', { name: /^Правка: кот → котик/ }).click();
    const card = page.getByRole('dialog', { name: 'Недоступная запись' });
    await expect(card).toContainText('конфликтует');
    await card.getByRole('button', { name: 'Удалить', exact: true }).click();

    // Оставшийся участник снова активен: производный текст и маркер появились.
    const sidecar = await waitSidecar(page, sidecarPath, (review) => review.edits.length === 1);
    expect(sidecar.edits[0]?.after).toBe('пёс ');
    // Маркер правки (✎) стоит на границе куска и виден в полученном тексте.
    const restored = await content.innerText();
    expect(restored.replace(/[✎⚡\n]/g, '')).toBe('пёс спит.');
    await expect(page.getByRole('button', { name: 'Правка', exact: true })).toBeVisible();
  } finally {
    await session.app.close();
  }
});

test('стек применения очищается после обычной мутации и после закрытия книги', async () => {
  const bookRoot = await makeTempDir('galley-e2e-stack-');
  await writeBook(bookRoot, fixtureReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);

    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeDisabled();
    await page.getByRole('button', { name: 'Правка', exact: true }).first().click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();

    // Обычная мутация (ввод) завершает стек применения.
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('!');
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Повторить применение' })).toBeDisabled();
  } finally {
    await session.app.close();
  }

  const closeRoot = await makeTempDir('galley-e2e-stackclose-');
  await writeBook(closeRoot, fixtureReview());
  const reopen = await launch(closeRoot);
  try {
    const page = reopen.page;
    await openOwnBook(reopen);
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await page.getByRole('button', { name: 'Правка', exact: true }).first().click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();

    // Закрытие книги очищает стек: после открытия отменить применение нельзя.
    await page.getByRole('button', { name: 'Закрыть книгу' }).click();
    await expect(page.getByRole('button', { name: 'Открыть папку…' })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('кит');
    await page.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeDisabled();
  } finally {
    await reopen.app.close();
  }
});
