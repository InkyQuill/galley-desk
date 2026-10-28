import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';
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

/** Failed-save cases intentionally cannot pass the app's graceful close gate. */
async function forceStop(app: ElectronApplication): Promise<void> {
  let child;
  try {
    child = app.process();
  } catch {
    return;
  }
  const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  await exited;
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
const CHAPTER2_PATH = 'Вторая.md';
const SIDECAR2_PATH = 'Вторая.review.json';
const CHAPTER_ID = randomUUID();
const CHAPTER2_ID = randomUUID();
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

function denseReview(): { source: string; review: Review } {
  const parts = Array.from({ length: 30 }, (_, index) => `фрагмент-${String(index).padStart(2, '0')}-${'длинныйтекст'.repeat(4)}`);
  const sourceText = `${parts.join('\n')}\n`;
  const source = new TextEncoder().encode(sourceText);
  const ranges = parts.map((part, index) => {
    const prefix = parts.slice(0, index).join('\n') + (index === 0 ? '' : '\n');
    const from = new TextEncoder().encode(prefix).length;
    return { from, to: from + new TextEncoder().encode(part).length };
  });
  const wrong = new TextEncoder().encode('чужой текст для недоступной записи');
  const edits: Review['edits'] = Array.from({ length: 24 }, (_, index) => ({
    id: randomUUID(),
    before: parts[index]!,
    after: index === 2
      ? ''
      : index === 3
        ? `вставленный-фрагмент-${parts[index]}`
        : `новая редакция ${index}: ${'ещёболееобстоятельныйтекст'.repeat(4)}`,
    anchor: index === 23 ? makeAnchor(wrong, { from: 0, to: wrong.length }) : makeAnchor(source, ranges[index]!),
  }));
  // Два участника конфликта при том же диапазоне.
  edits[1] = { ...edits[1]!, anchor: makeAnchor(source, ranges[0]!), before: parts[0]! };
  const signals: Review['signals'] = Array.from({ length: 6 }, (_, index) => ({
    id: randomUUID(),
    type: index === 0 ? 'warning' : 'note',
    selected_text: parts[index + 24]!,
    comment: `Комментарий сигнала ${index}: ${'подробно'.repeat(12)}`,
    anchor: makeAnchor(source, ranges[index + 24]!),
  }));
  return { source: sourceText, review: { schema_version: 1, chapter_id: CHAPTER_ID, source_path: CHAPTER_PATH, chapter_note: '', edits, signals } };
}

async function writeDenseBook(bookRoot: string): Promise<void> {
  const fixture = denseReview();
  const manifest = { schema_version: 1, book_id: randomUUID(), title: 'Плотная рецензия', chapters: [{ id: CHAPTER_ID, path: CHAPTER_PATH, title: 'Глава' }], ignored_files: [] };
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(bookRoot, CHAPTER_PATH), fixture.source, 'utf8');
  await writeFile(path.join(bookRoot, SIDECAR_PATH), encodeReview(fixture.review), 'utf8');
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

/** Книга из двух глав; у главы A предзаполнена заметка в sidecar. */
async function writeTwoChapterBook(bookRoot: string, review: Review, noteA: string): Promise<void> {
  const manifest = {
    schema_version: 1,
    book_id: randomUUID(),
    title: 'Тестовая книга',
    chapters: [
      { id: review.chapter_id, path: CHAPTER_PATH, title: 'Глава' },
      { id: CHAPTER2_ID, path: CHAPTER2_PATH, title: 'Вторая' },
    ],
    ignored_files: [],
  };
  await writeFile(path.join(bookRoot, '.pocket-editor.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(bookRoot, CHAPTER_PATH), SOURCE_TEXT, 'utf8');
  await writeFile(path.join(bookRoot, CHAPTER2_PATH), SOURCE_TEXT, 'utf8');
  await writeFile(path.join(bookRoot, SIDECAR_PATH), encodeReview({ ...review, chapter_note: noteA }), 'utf8');
}

/** Выделяет length символов с начала документа клавиатурой. */
async function selectFromStart(page: Page, skip: number, length: number): Promise<void> {
  // Клик у левого верхнего угла контента: не задевает виджеты-маркеры.
  await page.locator('.cm-content').click({ position: { x: 5, y: 8 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  for (let i = 0; i < skip; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < length; i++) await page.keyboard.press('Shift+ArrowRight');
}

/** Создаёт сигнал; dedicated keyboard-сценарий входит во flyout через Tab. */
async function createSignal(
  page: Page,
  sidecarPath: string,
  selection: { skip: number; length: number },
  type: string,
  comment: string,
  keyboardEntry = false,
): Promise<Review> {
  await selectFromStart(page, selection.skip, selection.length);
  const flyout = page.locator('[data-review-flyout]');
  await expect(flyout).toBeVisible();
  if (keyboardEntry) {
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(flyout.getByRole('button', { name: 'Заметка', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    const labels: Record<string, string> = {
      note: 'Заметка',
      change_required: 'Требуется правка',
      warning: 'Предупреждение',
      review: 'На проверку', good: 'Хорошо', brilliant: 'Блестяще',
    };
    await flyout.getByRole('button', { name: labels[type], exact: true }).click();
  }
  const textarea = page.getByRole('textbox', { name: 'Комментарий сигнала' });
  await expect(textarea).toBeFocused();
  if (comment !== '') await textarea.fill(comment);
  await textarea.press('ControlOrMeta+Enter');
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

    // Запрет записи вызывает ошибку сохранения без гонки с наблюдателем
    // удаления исходника: черновик заметки не сбрасывается.
    await page.getByRole('button', { name: 'Заметка главы' }).click();
    await note.fill('Глава требует вычитки и правки');
    await chmod(bookRoot, 0o555);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Заметка главы' }).getByRole('alert')).toBeVisible();
    await expect(note).toHaveValue('Глава требует вычитки и правки');

    // Книжный уровень того же сбоя — плавающая карточка в центре уведомлений
    // с единственным действием «Перечитать главу» (Task 8); алерт формы
    // остаётся внутри диалога заметки, у своего действия.
    const workNotice = page.locator('.notice-center .notice--error');
    await expect(workNotice).toBeVisible();
    await expect(workNotice.getByRole('button', { name: 'Перечитать главу' })).toHaveCount(1);
  } finally {
    await chmod(bookRoot, 0o755);
    await forceStop(session.app);
  }
});

test('черновик заметки главы не переезжает в другую главу', async () => {
  const bookRoot = await makeTempDir('galley-e2e-notekey-');
  await writeTwoChapterBook(bookRoot, emptyReview(), 'Заметка первой главы');
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarAPath = path.join(bookRoot, SIDECAR_PATH);
    const sidecarBPath = path.join(bookRoot, SIDECAR2_PATH);
    const sidecarABefore = await readFile(sidecarAPath, 'utf8');

    // Попап главы A: заметка видна, черновик правится, но не сохраняется.
    await page.getByRole('button', { name: 'Заметка главы' }).click();
    const noteA = page.getByRole('textbox', { name: 'Текст заметки' });
    await expect(noteA).toHaveValue('Заметка первой главы');
    await noteA.fill('Черновик главы A');

    // Смена главы закрывает попап: у главы B своя (пустая) заметка.
    await page.getByRole('button', { name: 'Вторая', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Заметка главы' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Заметка главы' }).click();
    const noteB = page.getByRole('textbox', { name: 'Текст заметки' });
    await expect(noteB).toHaveValue('');
    await noteB.fill('Заметка второй главы');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();

    const sidecarB = await waitSidecar(page, sidecarBPath, (review) => review.chapter_note !== '');
    expect(sidecarB.chapter_note).toBe('Заметка второй главы');
    // Sidecar главы A не перезаписан: черновик A не доехал до главы B.
    expect(await readFile(sidecarAPath, 'utf8')).toBe(sidecarABefore);
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
    await page.getByRole('button', { name: 'Замена', exact: true }).first().click();
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

    const sidecar = await createSignal(page, sidecarPath, { skip: 0, length: 3 }, 'note', 'Обсудить', true);
    const signal = sidecar.signals.find((candidate) => candidate.comment === 'Обсудить');
    expect(signal?.type).toBe('note');
    expect(signal?.selected_text).toBe('кот');
    // Маркер остаётся в gutter, комментарий — в панели и карточке.
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toBeVisible();
    await expect(page.locator('.gd-signal-comment')).toHaveCount(1);
    await expect(page.locator('.book__review')).toContainText('Обсудить');
    await page.getByRole('button', { name: 'Сигнал', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Комментарий сигнала' })).toHaveValue('Обсудить');
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

test('шесть типов сигналов получают свои цвета flyout; пересекающиеся сигналы независимы', async () => {
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
      good: 'rgb(40, 107, 58)',
      brilliant: 'rgb(155, 59, 112)',
    };
    for (const [type, rgb] of Object.entries(expectedColors)) {
      expect(
        await flyout
          .getByRole('button', { name: ({ note: 'Заметка', change_required: 'Требуется правка', warning: 'Предупреждение', review: 'На проверку', good: 'Хорошо', brilliant: 'Блестяще' })[type], exact: true })
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe(rgb);
    }

    // Пустой комментарий допустим; правка существующего сигнала — отдельный тест.
    await createSignal(page, sidecarPath, { skip: 0, length: 3 }, 'note', '');
    // Пересекающийся сигнал на том же диапазоне: оба маркера остаются видимы.
    await createSignal(page, sidecarPath, { skip: 0, length: 3 }, 'change_required', 'Проверить');
    await createSignal(page, sidecarPath, { skip: 4, length: 4 }, 'warning', 'Тон');
    await createSignal(page, sidecarPath, { skip: 8, length: 1 }, 'review', '');
    await createSignal(page, sidecarPath, { skip: 0, length: 3 }, 'good', '');
    await createSignal(page, sidecarPath, { skip: 4, length: 4 }, 'brilliant', 'Сохранить');
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toHaveCount(6);
    await expect(page.locator('.gd-signal-comment')).toHaveCount(3);
    await expect(page.locator('.book__review')).toContainText('Проверить');
    await expect(page.locator('.book__review')).toContainText('Тон');

    const sidecar = await readSidecar(sidecarPath);
    const types = sidecar?.signals.map((signal) => signal.type).sort() ?? [];
    expect(types).toEqual(['brilliant', 'change_required', 'good', 'note', 'review', 'warning']);
    expect(await readFile(path.join(bookRoot, CHAPTER_PATH), 'utf8')).toBe(SOURCE_TEXT);
    await expect(page.locator('.book__review')).toContainText('Хорошо');
    await expect(page.locator('.book__review')).toContainText('Блестяще');
    expect(sidecar?.signals.find((signal) => signal.type === 'note')?.comment).toBe('');

    // Удаление: zero-width маркер с доступным названием остаётся видимым.
    await selectFromStart(page, 4, 4);
    await page.keyboard.press('Backspace');
    await expect(page.getByRole('button', { name: 'Удаление: спит', exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByRole('button', { name: 'Удаление: спит', exact: true })).toHaveCount(0);

    // «Исходник» немаркированный: ни маркеров, ни flyout.
    await page.getByRole('button', { name: 'Исходник', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сигнал', exact: true })).toHaveCount(0);
    await expect(page.locator('.book__source')).toHaveText(SOURCE_TEXT);
  } finally {
    await session.app.close();
  }
});

test('flyout привязан к живой геометрии: hover подсвечивает действие, прокрутка прячет и возвращает панель', async () => {
  const bookRoot = await makeTempDir('galley-e2e-flyout-scroll-');
  const paragraphs = Array.from({ length: 120 }, (_, i) => `Абзац ${i}: строка для прокрутки главы.`);
  const sourceText = `${paragraphs.join('\n\n')}\n`;
  await writeBook(bookRoot, emptyReview());
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);
    const mdPath = path.join(bookRoot, CHAPTER_PATH);
    const mdBefore = await readFile(mdPath, 'utf8');
    const sidecarBefore = await readFile(sidecarPath, 'utf8');
    const content = page.locator('.cm-content');
    const flyout = page.locator('[data-review-flyout]');
    const scroller = page.locator('.cm-scroller');

    await selectFromStart(page, 0, 6);
    await expect(flyout).toBeVisible();
    // Hover обязан подсвечивать действие: inline background: transparent
    // сильнее общего hover-правила и гасит отклик.
    const note = flyout.getByRole('button', { name: 'Заметка', exact: true });
    const idle = await note.evaluate((element) => getComputedStyle(element).backgroundColor);
    await note.hover();
    await expect.soft.poll(async () => note.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(idle);

    // Выделение покидает viewport → панель прячется.
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.soft(flyout).toHaveCount(0);

    // Возврат прокрутки возвращает панель к тому же выделению.
    await scroller.evaluate((element) => { element.scrollTop = 0; });
    await expect(flyout).toBeVisible();
    await expect.poll(async () => {
      const box = await flyout.boundingBox();
      const end = await content.evaluate((element) => {
        const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
        return view.coordsAtPos(view.state.selection.main.to);
      });
      if (box === null || end === null) return false;
      // Панель стоит сразу под концом выделения (top = bottom + 6).
      return box.y >= end.bottom - 1 && box.y - end.bottom <= 40;
    }).toBe(true);
    // Само выделение round-trip прокрутки не тронул.
    expect(await content.evaluate((element) => {
      const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      const { from, to } = view.state.selection.main;
      return { from, to };
    })).toEqual({ from: 0, to: 6 });
    // И данные не тронуты: глава и sidecar байт в байт.
    expect(await readFile(mdPath, 'utf8')).toBe(mdBefore);
    expect(await readFile(sidecarPath, 'utf8')).toBe(sidecarBefore);

    // Переход из панели рецензии открывает только попап записи: панель
    // действий не воскресает поверх попапа, в том числе при прокрутке.
    await createSignal(page, sidecarPath, { skip: 0, length: 6 }, 'note', 'Прокрутка');
    await selectFromStart(page, 20, 6);
    await expect(flyout).toBeVisible();
    await page.getByRole('button', { name: 'Сигнал [note]: Прокрутка' }).click();
    const popup = page.getByRole('dialog', { name: 'Сигнал' });
    await expect(popup).toBeVisible();
    await expect(flyout).toHaveCount(0);
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(popup).toBeVisible();
    await expect(flyout).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  } finally {
    await session.app.close();
  }
});

test('изменение существующего сигнала заменяет тип и комментарий, не дублируя запись', async () => {
  const bookRoot = await makeTempDir('galley-e2e-resignal-');
  await writeBook(bookRoot, emptyReview());
  const session = await launch(bookRoot);
  // Slow rendering exposed Tab arriving before the visible flyout registered
  // its focus callback. Keep the assertion native and the stress local to this test.
  const cdp = await session.page.context().newCDPSession(session.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  try {
    const page = session.page;
    await openOwnBook(session);
    const sidecarPath = path.join(bookRoot, SIDECAR_PATH);

    const before = await createSignal(page, sidecarPath, { skip: 0, length: 3 }, 'note', 'Первый');
    const signalId = before.signals[0]!.id;

    // Клик по молнии открывает тот же попап с типом и комментарием.
    await page.getByRole('button', { name: 'Сигнал', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Сигнал' });
    await expect(dialog).toBeVisible();
    const textarea = dialog.getByRole('textbox', { name: 'Комментарий сигнала' });
    await expect(textarea).toHaveValue('Первый');
    await dialog.getByRole('button', { name: 'На проверку', exact: true }).click();
    await textarea.fill('Второй');
    await textarea.press('ControlOrMeta+Enter');

    const sidecar = await waitSidecar(page, sidecarPath, (review) =>
      review.signals.length === 1 && review.signals[0] !== undefined && review.signals[0].comment === 'Второй');
    expect(sidecar.signals[0]?.type).toBe('review');
    expect(sidecar.signals[0]?.id).toBe(signalId);
    expect(sidecar.signals).toHaveLength(1);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
    await cdp.detach();
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
    const sidecar = await createSignal(page, sidecarPath, { skip: 3, length: 2 }, 'review', 'Новое');
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

    await page.getByRole('button', { name: /^Замена: кот → кит — недоступна/ }).click();
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

test('плотная рецензия остаётся читаемой при ширине 240–560 px', async () => {
  const bookRoot = await makeTempDir('galley-e2e-dense-review-');
  await writeDenseBook(bookRoot);
  const session = await launch(bookRoot);
  try {
    const { page } = session;
    await openOwnBook(session);
    await page.setViewportSize({ width: 1920, height: 900 });
    const records = page.locator('.book__record');
    await expect(records).toHaveCount(30);
    const initialNames = await records.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));

    const first = records.first();
    // Слова «Было/Стало» заменены иконками: в тексте строк их больше нет,
    // а полный текст правки остаётся в aria-label (и Tooltip).
    await expect(page.locator('.book__records')).not.toContainText('Было');
    await expect(page.locator('.book__records')).not.toContainText('Стало');
    // Первая активная запись dense-фикстуры — deletion (eds 0/1 конфликтуют
    // и уходят в конец): minus-иконка и одна строка «Было».
    expect(initialNames[0]).toContain('фрагмент-02');
    await expect(first.locator('svg.tabler-icon-minus')).toHaveCount(1);
    await expect(first.locator('svg.tabler-icon-pencil, svg.tabler-icon-plus')).toHaveCount(0);
    await expect(first.locator('.book__record-part')).toHaveCount(1);
    // Conflicting replacement: карандаш и обе строки с компактными минус/плюс.
    const replacementRow = page.getByRole('button', { name: /^Замена: фрагмент-00/ }).first();
    await expect(replacementRow.locator('svg.tabler-icon-pencil')).toHaveCount(1);
    await expect(replacementRow.locator('svg.tabler-icon-minus')).toHaveCount(1);
    await expect(replacementRow.locator('svg.tabler-icon-plus')).toHaveCount(1);
    await expect(page.locator('.book__record-status', { hasText: 'конфликтует' })).toHaveCount(2);
    await expect(page.locator('.book__record-status', { hasText: 'недоступна' })).toHaveCount(1);
    // Обрезанная вставка показывает заполнитель пустой строки «Было».
    await expect(page.getByText('вставка', { exact: true })).toBeVisible();
    await expect(page.getByText('Предупреждение', { exact: true })).toBeVisible();

    const reviewResizer = page.getByRole('separator', { name: 'Ширина рецензии' });
    let currentWidth = 336;
    for (const width of [336, 240, 560]) {
      await reviewResizer.focus();
      // Правая граница зеркальна: ArrowRight сужает правую колонку.
      const key = width < currentWidth ? 'ArrowRight' : 'ArrowLeft';
      for (let step = 0; step < Math.abs(width - currentWidth) / 16; step++) await page.keyboard.press(key);
      currentWidth = width;
      await expect(page.locator('.book__review')).toHaveCSS('width', `${width}px`);
      await expect.poll(() => page.locator('.book__review').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect.poll(() => records.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(initialNames);
      await expect(first.locator('.book__record-excerpt').first()).toHaveCSS('-webkit-line-clamp', '3');
      await page.screenshot({ path: test.info().outputPath(`dense-review-${width}.png`) });
    }

    await first.focus();
    const tooltip = page.locator('#gd-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('длинныйтекст');
    const tooltipBox = await tooltip.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(tooltipBox!.x).toBeGreaterThanOrEqual(8);
    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(1912);

    const unavailable = page.locator('.book__record--unavailable').first();
    await unavailable.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Недоступная запись' })).toBeVisible();
    await page.keyboard.press('Escape');
    const active = page.getByRole('button', { name: /^Замена:/ }).filter({ hasNot: page.locator('.book__record-status') }).first();
    await active.click();
    await expect(page.getByRole('dialog', { name: 'Правка' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Применить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toBeVisible();
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
    await expect(page.getByRole('button', { name: /^Замена: .* — конфликтует/ })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Правка', exact: true })).toHaveCount(0);

    // Карточка конфликтующей записи открывается в панели.
    await page.getByRole('button', { name: /^Замена: кот → котик/ }).click();
    const card = page.getByRole('dialog', { name: 'Недоступная запись' });
    await expect(card).toContainText('конфликтует');
    await card.getByRole('button', { name: 'Удалить', exact: true }).click();

    // Оставшийся участник снова активен: производный текст и маркер появились.
    const sidecar = await waitSidecar(page, sidecarPath, (review) => review.edits.length === 1);
    expect(sidecar.edits[0]?.after).toBe('пёс ');
    // Маркер правки (✎) стоит на границе куска и виден в полученном тексте.
    await expect.poll(async () => (await content.innerText()).replace(/[✎⚡\n]/g, '')).toBe('пёс спит.');
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
    await page.getByRole('button', { name: 'Замена', exact: true }).first().click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();

    // Обычная мутация (ввод) завершает стек применения.
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
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
    await page.getByRole('button', { name: 'Замена', exact: true }).first().click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить применение' })).toBeEnabled();

    // Закрытие книги очищает стек: после открытия отменить применение нельзя.
    await page.getByRole('button', { name: 'Меню книги' }).click();
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


test('gutter: before preview preserves typing focus, selection flyout wins, buttons remain keyboard actionable', async () => {
  const bookRoot = await makeTempDir('galley-e2e-gutter-');
  await writeBook(bookRoot, fixtureReview());
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const content = page.locator('.cm-content');
    const preview = page.getByRole('tooltip', { name: 'До правки' });
    const markers = page.locator('.gd-review-gutter .gd-record-marker');
    await expect(markers).toHaveCount(2);
    expect(await markers.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-record-id')))).toEqual([EDIT_ID, SIGNAL_ID]);
    await expect(content.locator('.gd-record-marker')).toHaveCount(0);
    await selectFromStart(page, 1, 0);
    await expect(preview).toContainText('о');
    await page.screenshot({ path: test.info().outputPath('gutter-preview.png') });
    await expect(content).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.type('а');
    await expect(content).toContainText('каит');
    await expect(content).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await page.getByRole('button', { name: 'Режим Zen', exact: true }).click();
    await content.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.book--zen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book--zen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.book--zen')).toBeVisible();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+z' : 'Control+Alt+z');
    await expect(page.locator('.book--zen')).toHaveCount(0);
    await page.locator('.gd-edit-range').hover();
    await expect(preview).toContainText('о');
    await expect(content).toBeFocused();
    await page.locator('.gd-edit-range').click();
    await expect(page.getByRole('dialog', { name: 'Правка' })).toBeVisible();
    await page.locator('.gd-edit-range').hover();
    await expect(preview).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await selectFromStart(page, 0, 2);
    await expect(preview).toHaveCount(0);
    await expect(page.locator('[data-review-flyout]')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-review-flyout]').getByRole('button', { name: 'Заметка', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await selectFromStart(page, 0, 0);
    await markers.first().focus();
    await expect(preview).toContainText('о');
    await page.keyboard.press('Tab');
    await expect(markers.nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(markers.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Правка' })).toBeVisible();
  } finally { await session.app.close(); }
});

test('gutter follows wrapped Markdown and scrolling; deletion has its own focusable before preview', async () => {
  const bookRoot = await makeTempDir('galley-e2e-wrap-gutter-');
  const prefix = '# Heading\n\n' + 'Long paragraph with **Markdown** and ordinary words. '.repeat(20);
  const sourceText = prefix + 'DELETE target ending.\n' + 'Another paragraph.\n\n'.repeat(80);
  const source = new TextEncoder().encode(sourceText);
  const deletionId = randomUUID();
  const targetId = randomUUID();
  const review: Review = { ...emptyReview(), edits: [
    { id: deletionId, before: 'DELETE ', after: '', anchor: makeAnchor(source, { from: prefix.length, to: prefix.length + 7 }) },
    { id: targetId, before: 'target', after: 'replacement', anchor: makeAnchor(source, { from: prefix.length + 7, to: prefix.length + 13 }) },
  ] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const deletion = page.getByRole('button', { name: 'Удаление: DELETE ', exact: true });
    // Navigate through the sidebar so CodeMirror materializes this wrapped row.
    await page.getByRole('button', { name: /^Удаление: DELETE / }).click();
    await page.keyboard.press('Escape');
    await expect(deletion).toBeVisible();
    const range = page.locator('.gd-edit-range').filter({ hasText: 'replacemen' });
    await expect.poll(async () => {
      const markerBox = await deletion.boundingBox();
      const rangeBox = await range.boundingBox();
      return Math.abs((markerBox?.y ?? -1000) - (rangeBox?.y ?? 0));
    }).toBeLessThan(5);
    await page.locator('.cm-content').press('ArrowLeft');
    // The preceding gutter test covers sequential Tab navigation. Focus this
    // deletion directly so macOS keyboard-navigation preferences cannot skip
    // the button while this test verifies its own focus preview and action.
    await deletion.evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
    await expect(deletion).toBeFocused();
    // Focus scroll can arrive after focusin; it must not erase its own preview.
    await page.locator('.cm-scroller').evaluate(element => { element.scrollTop += 1; });
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('DELETE');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Правка' })).toContainText('DELETE');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
    const inlineDeletion = page.getByRole('button', { name: 'Удалённый текст', exact: true });
    await inlineDeletion.evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
    await expect(inlineDeletion).toBeFocused();
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('DELETE');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
    await range.hover();
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('targe');
    await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop += 500; });
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
    await expect(page.locator('.cm-content .gd-record-marker, .gd-signal-comment')).toHaveCount(0);
  } finally { await session.app.close(); }
});

test('long chapter deletion around an existing deletion keeps reading position through undo and redo', async () => {
  const bookRoot = await makeTempDir('galley-e2e-viewport-');
  const paragraphs = Array.from({ length: 160 }, (_, i) => `Paragraph ${i}: ` + 'Quiet words along the river. '.repeat(8) + '\n\n');
  const sourceText = paragraphs.join('');
  const paragraph = paragraphs[90]!;
  const from = paragraphs.slice(0, 90).join('').length;
  const deleted = 'along the river. ';
  const deletionFrom = sourceText.indexOf(deleted, from);
  const review: Review = { ...emptyReview(), edits: [{
    id: randomUUID(), before: deleted, after: '',
    anchor: makeAnchor(new TextEncoder().encode(sourceText), { from: deletionFrom, to: deletionFrom + deleted.length }),
  }] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const derived = sourceText.slice(0, deletionFrom) + sourceText.slice(deletionFrom + deleted.length);
  const after = derived.slice(0, from) + derived.slice(from + paragraph.length - deleted.length);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const content = page.locator('.cm-content');
    await content.evaluate((element, range) => {
      const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      view.focus();
    }, { from, to: from + paragraph.length - deleted.length });
    const measure = () => content.evaluate((element) => {
      const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      const anchor = view.state.selection.main.anchor;
      const coords = view.coordsAtPos(anchor);
      const bounds = view.scrollDOM.getBoundingClientRect();
      return { text: view.state.doc.toString(), anchor, y: coords?.top ?? -10000, top: bounds.top, bottom: bounds.bottom,
        line: view.state.doc.lineAt(anchor).text };
    });
    await expect.poll(async () => {
      const current = await measure();
      return current.y > current.top && current.y < current.bottom;
    }).toBe(true);
    const beforeDeletion = await measure();
    await page.keyboard.press('Backspace');
    await expect.poll(async () => (await measure()).text).toBe(after);
    await expect.poll(async () => Math.abs((await measure()).y - beforeDeletion.y)).toBeLessThan(4);
    await waitSaveDrained(page, path.join(bookRoot, SIDECAR_PATH));
    const baseline = await measure();
    expect(baseline.anchor).toBe(from);
    expect(baseline.line).toContain('Paragraph 91:');
    expect(baseline.y).toBeGreaterThan(baseline.top);
    expect(baseline.y).toBeLessThan(baseline.bottom);
    for (const [key, expected, line] of [
      ['ControlOrMeta+z', derived, 'Paragraph 90:'],
      ['ControlOrMeta+y', after, 'Paragraph 91:'],
      ['ControlOrMeta+z', derived, 'Paragraph 90:'],
    ] as const) {
      await page.keyboard.press(key);
      await expect.poll(async () => (await measure()).text).toBe(expected);
      await expect.poll(async () => Math.abs((await measure()).y - baseline.y)).toBeLessThan(4);
      const current = await measure();
      expect(current.anchor).toBe(from);
      expect(current.line).toContain(line);
      await expect(content).toBeFocused();
    }
    // Explicit navigation still moves the viewport after snapshot restoration.
    await content.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await expect.poll(async () => (await measure()).anchor).toBe(derived.length);
    await expect.poll(async () => (await measure()).y).toBeGreaterThan(baseline.top);
    expect(await readFile(path.join(bookRoot, CHAPTER_PATH), 'utf8')).toBe(sourceText);
  } finally { await session.app.close(); }
});

test('review annotation content, support ranges, safe comments and popup dismissal', async () => {
  const bookRoot = await makeTempDir('galley-e2e-annotations-');
  const sourceText = 'alpha DELETE omega\nwrapped line\n\nSecond paragraph.';
  const source = new TextEncoder().encode(sourceText);
  const comment = '<img src=x onerror=alert(1)> plain comment';
  const review: Review = { ...emptyReview(), edits: [
    { id: randomUUID(), before: 'DELETE ', after: '', anchor: makeAnchor(source, { from: 6, to: 13 }) },
    { id: randomUUID(), before: 'alpha', after: 'alphabeta', anchor: makeAnchor(source, { from: 0, to: 5 }) },
  ], signals: [
    { id: '00000000-0000-4000-8000-000000000001', type: 'note', selected_text: 'omega', comment, anchor: makeAnchor(source, { from: 13, to: 18 }) },
    { id: '00000000-0000-4000-8000-000000000002', type: 'warning', selected_text: 'omega', comment: 'Second comment', anchor: makeAnchor(source, { from: 13, to: 18 }) },
  ] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const content = page.locator('.cm-content');
    await expect(page.locator('.gd-edit-range')).toHaveText('beta');
    const annotations = page.locator('.gd-signal-comment');
    await expect(annotations).toHaveText([comment, 'Second comment']);
    await expect(annotations.locator('img')).toHaveCount(0);
    const line = page.locator('.cm-line').filter({ hasText: 'wrapped line' });
    expect((await annotations.first().boundingBox())!.y).toBeGreaterThan((await line.boundingBox())!.y);
    const trash = page.getByRole('button', { name: 'Удалённый текст', exact: true });
    await expect(trash).toBeVisible();
    await expect(trash).toHaveText('');
    await trash.hover();
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('DELETE');
    await trash.click();
    const popup = page.getByRole('dialog', { name: 'Правка', exact: true });
    await expect(popup).toBeVisible();
    await popup.hover();
    await page.waitForTimeout(300);
    await expect(popup).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(popup).toHaveCount(0);
    await trash.click();
    await expect(popup).toBeVisible();
    await content.focus();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(popup).toHaveCount(0);
    await trash.click();
    await expect(popup).toBeVisible();
    await page.getByRole('textbox', { name: 'Фильтр глав' }).click();
    await expect(popup).toHaveCount(0);
    await selectFromStart(page, 0, 0);
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    const copied = await session.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toBe(sourceText.replace('alpha', 'alphabeta').replace('DELETE ', ''));
    await page.keyboard.press('Escape');
    await selectFromStart(page, 0, 3);
    await page.locator('[data-review-flyout]').getByRole('button', { name: 'Заметка', exact: true }).click();
    const draft = page.getByRole('dialog', { name: 'Новый сигнал' });
    await draft.getByRole('textbox').fill('unsaved draft');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    await expect(draft.getByRole('textbox')).toHaveValue('unsaved draft');
    expect((await draft.boundingBox())!.width).toBeGreaterThan(400);
    await page.screenshot({ path: '/tmp/galley-task3-signal-light.png' });
    await draft.getByRole('button', { name: 'Отмена' }).click();
    await expect(content).toBeFocused();
    await page.getByRole('button', { name: 'Меню книги' }).click();
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.getByLabel('Тема', { exact: true }).selectOption('gruvbox-dark');
    await page.getByRole('button', { name: 'Закрыть оформление' }).click();
    await page.screenshot({ path: '/tmp/galley-task3-annotations-dark.png' });
    await annotations.first().click();
    const signalForm = page.getByRole('dialog', { name: 'Сигнал', exact: true });
    await signalForm.getByRole('textbox').fill('Long safe comment '.repeat(2000));
    await signalForm.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.keyboard.press('Escape');
    const updatedComment = page.locator('.gd-signal-comment[data-record-id="00000000-0000-4000-8000-000000000001"]');
    await expect(updatedComment).toContainText('Long safe comment');
    await selectFromStart(page, 0, 0);
    await updatedComment.hover();
    const signalPreview = page.getByRole('tooltip', { name: 'Комментарий сигнала' });
    await expect(signalPreview).toContainText('Long safe comment');
    const bounds = await signalPreview.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    await page.mouse.move(2, 2);
    await expect(signalPreview).toHaveCount(0);
  } finally { await session.app.close(); }
});

async function holdReviewCommands(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get('desk:command')!;
    const state = globalThis as unknown as { releaseReview: () => void; reviewHeld: boolean };
    state.reviewHeld = false;
    const gate = new Promise<void>((resolve) => { state.releaseReview = resolve; });
    ipcMain.removeHandler('desk:command');
    ipcMain.handle('desk:command', async (...args) => {
      state.reviewHeld = true;
      await gate;
      return original(...args);
    });
  });
}
async function releaseReviewCommands(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => (globalThis as unknown as { releaseReview?: () => void }).releaseReview?.());
}

test('delayed ACK maps highlighted support-prefix edit, gutter, preview and reveal together', async () => {
  const bookRoot = await makeTempDir('galley-e2e-mapped-visual-');
  const id = randomUUID();
  const sourceText = 'abc trailing';
  await writeBook(bookRoot, { ...emptyReview(), edits: [{ id, before: 'abc', after: 'abXc', anchor: makeAnchor(Buffer.from(sourceText), { from: 0, to: 3 }) }] });
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const { page, app } = session;
    await openOwnBook(session);
    await holdReviewCommands(app);
    await selectFromStart(page, 1, 0);
    await page.keyboard.insertText('Y');
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld)).toBe(true);
    const marker = page.locator(`.gd-review-gutter [data-record-id="${id}"]`);
    await expect(page.locator('.gd-edit-range')).toHaveText('X');
    await expect(marker).toHaveAttribute('data-record-pos', '3');
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toHaveCount(0);
    await page.keyboard.press('ArrowRight'); // caret reaches the actual X at 3
    await expect(page.getByRole('tooltip', { name: 'До правки' })).toContainText('Добавление');
    await page.getByRole('button', { name: /^Замена: abc/ }).click();
    const selected = () => page.locator('.cm-content').evaluate((element) => {
      const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      const selection = view.state.selection.main;
      return { from: selection.from, to: selection.to, text: view.state.sliceDoc(selection.from, selection.to) };
    });
    expect(await selected()).toEqual({ from: 3, to: 4, text: 'X' });
    await page.keyboard.press('Escape');
    await releaseReviewCommands(app);
    await expect(page.locator('.gd-edit-range')).toHaveText('YbX');
    await expect(marker).toHaveAttribute('data-record-pos', '1');
    await selectFromStart(page, 1, 0);
    await expect(page.getByRole('tooltip', { name: 'До правки' }).locator('p')).toHaveText('b');
    await page.getByRole('button', { name: /^Замена: abc/ }).click();
    expect(await selected()).toEqual({ from: 1, to: 4, text: 'YbX' });
  } finally { await releaseReviewCommands(session.app); await session.app.close(); }
});

test('delayed ACK keeps edit popup open for typing inside its live mapped range', async () => {
  const bookRoot = await makeTempDir('galley-e2e-live-popup-');
  const sourceText = 'abc trailing';
  await writeBook(bookRoot, { ...emptyReview(), edits: [{ id: randomUUID(), before: 'abc', after: 'abXYZc', anchor: makeAnchor(Buffer.from(sourceText), { from: 0, to: 3 }) }] });
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const { page, app } = session;
    await openOwnBook(session);
    await holdReviewCommands(app);
    await selectFromStart(page, 3, 0);
    // Use the gutter to keep the insertion caret inside the visual range.
    await page.locator('.gd-review-gutter .gd-record-marker').click();
    const popup = page.getByRole('dialog', { name: 'Правка', exact: true });
    await expect(popup).toBeVisible();
    await page.locator('.cm-content').focus();
    await page.keyboard.insertText('QQQQ');
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld)).toBe(true);
    await expect(page.locator('.gd-edit-range')).toHaveText('XQQQQYZ');
    await page.waitForTimeout(100);
    await expect(popup).toBeVisible();
    await releaseReviewCommands(app);
    await waitSaveDrained(page, path.join(bookRoot, SIDECAR_PATH));
    await expect(popup).toBeVisible();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(popup).toHaveCount(0);
  } finally { await releaseReviewCommands(session.app); await session.app.close(); }
});

for (const to of [4, 5]) {
  test(`paragraph annotation stays before the next paragraph when selection ends at ${to}`, async () => {
    const bookRoot = await makeTempDir('galley-e2e-paragraph-comment-');
    const sourceText = 'one\n\nTwo';
    await writeBook(bookRoot, { ...emptyReview(), signals: [{ id: randomUUID(), type: 'note', selected_text: sourceText.slice(0, to), comment: 'First paragraph note', anchor: makeAnchor(Buffer.from(sourceText), { from: 0, to }) }] });
    await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
    const session = await launch(bookRoot);
    try {
      const { page } = session;
      await openOwnBook(session);
      const first = await page.locator('.cm-line').filter({ hasText: /^one$/ }).boundingBox();
      const next = await page.locator('.cm-line').filter({ hasText: /^Two$/ }).boundingBox();
      const comment = await page.locator('.gd-signal-comment').boundingBox();
      expect(comment!.y).toBeGreaterThan(first!.y);
      expect(comment!.y + comment!.height).toBeLessThanOrEqual(next!.y);
      expect(await readFile(path.join(bookRoot, CHAPTER_PATH), 'utf8')).toBe(sourceText);
    } finally { await session.app.close(); }
  });
}

test('переход к удалению из панели: placeholder в viewport, текст главы не гаснет, попап открыт', async () => {
  const bookRoot = await makeTempDir('galley-e2e-reveal-deletion-');
  const START = 'УДАЛИТЬСТАРТ';
  const MID = 'УДАЛИТЬСЕРЕДИНА';
  const END = 'УДАЛИТЬКОНЕЦ';
  const filler = ' Тихие слова вдоль реки.';
  const head = Array.from({ length: 80 }, (_, i) => `Абзац ${String(i).padStart(3, '0')}:${filler.repeat(6)}`);
  const tail = Array.from({ length: 80 }, (_, i) => `Хвост ${String(i).padStart(3, '0')}:${filler.repeat(6)}`);
  const sourceText = [`${START} Альфа`, ...head, `кот ${MID} Омега`, 'текст-метка преемник', ...tail, `Финал ${END}`].join('\n');
  const derivedText = [' Альфа', ...head, 'кит  Омега', 'вставленный текст-метка преемник', ...tail, 'Финал '].join('\n');
  const delStartId = randomUUID();
  const replId = randomUUID();
  const insId = randomUUID();
  const delMidId = randomUUID();
  const delEndId = randomUUID();
  const source = new TextEncoder().encode(sourceText);
  const rangeOf = (needle: string) => {
    const from = new TextEncoder().encode(sourceText.slice(0, sourceText.indexOf(needle))).length;
    return { from, to: from + new TextEncoder().encode(needle).length };
  };
  const review: Review = { ...emptyReview(), edits: [
    { id: delStartId, before: START, after: '', anchor: makeAnchor(source, rangeOf(START)) },
    { id: replId, before: 'кот', after: 'кит', anchor: makeAnchor(source, rangeOf('кот')) },
    { id: insId, before: 'текст-метка', after: 'вставленный текст-метка', anchor: makeAnchor(source, rangeOf('текст-метка')) },
    { id: delMidId, before: MID, after: '', anchor: makeAnchor(source, rangeOf(MID)) },
    { id: delEndId, before: END, after: '', anchor: makeAnchor(source, rangeOf(END)) },
  ] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const content = page.locator('.cm-content');
    const scroller = page.locator('.cm-scroller');
    const popup = page.getByRole('dialog', { name: 'Правка', exact: true });
    await expect(page.locator('.book__record')).toHaveCount(5);
    const docText = () => content.evaluate((element) => {
      const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      return view.state.doc.toString();
    });

    // Удаления: EOF → начало → середина; каждый следующий переход требует
    // прокрутки к другому краю длинной главы.
    for (const [name, id, neighbour] of [
      ['Удаление: УДАЛИТЬКОНЕЦ →', delEndId, 'Финал'],
      ['Удаление: УДАЛИТЬСТАРТ →', delStartId, 'Альфа'],
      ['Удаление: УДАЛИТЬСЕРЕДИНА →', delMidId, 'Омега'],
    ] as const) {
      await page.getByRole('button', { name }).click();
      await expect(popup).toBeVisible();
      // Документ не повреждён переходом: производный текст равен ожидаемому.
      expect(await docText()).toBe(derivedText);
      // .cm-content не «гаснет»: текст вокруг точки удаления остаётся в DOM.
      const contentText = await content.evaluate((element) => element.textContent ?? '');
      expect(contentText).toContain(neighbour);
      const placeholder = content.locator(`[data-record-id="${id}"]`);
      await expect(placeholder).toBeVisible();
      await expect.poll(async () => {
        const box = await placeholder.boundingBox();
        const frame = await scroller.boundingBox();
        if (box === null || frame === null) return false;
        return box.y >= frame.y - 1 && box.y + box.height <= frame.y + frame.height + 1;
      }).toBe(true);
      const scrollTop = await scroller.evaluate((element) => element.scrollTop);
      expect(Number.isFinite(scrollTop)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
    }

    // Замена и вставка продолжают работать: попап у непустого выделения.
    for (const [name, expected] of [
      ['Замена: кот → кит', 'и'],
      ['Замена: текст-метка → вставленный текст-метка', 'вставленный'],
    ] as const) {
      await page.getByRole('button', { name }).click();
      await expect(popup).toBeVisible();
      expect(await docText()).toBe(derivedText);
      const selection = await content.evaluate((element) => {
        const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
        const main = view.state.selection.main;
        return { empty: main.empty, text: view.state.sliceDoc(main.from, main.to) };
      });
      expect(selection.empty).toBe(false);
      expect(selection.text).toContain(expected);
      await page.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
    }
  } finally { await session.app.close(); }
});

test('переход к удалению на пустой строке: попап у якоря, прокрутка не заклинивает', async () => {
  const bookRoot = await makeTempDir('galley-e2e-reveal-empty-line-');
  const filler = ' Тихие слова вдоль реки.';
  const head = Array.from({ length: 40 }, (_, i) => `Голова ${String(i).padStart(3, '0')}:${filler.repeat(6)}`);
  const tail = Array.from({ length: 40 }, (_, i) => `Хвост ${String(i).padStart(3, '0')}:${filler.repeat(6)}`);
  // Удаление «X» оставляет пустую строку: точка записи лежит между переносами.
  const sourceText = [...head, 'Альфа', 'X', 'Омега', ...tail, 'УДАЛИТЬХВОСТ'].join('\n');
  const derivedText = [...head, 'Альфа', '', 'Омега', ...tail, ''].join('\n');
  const emptyLineId = randomUUID();
  const tailId = randomUUID();
  const source = new TextEncoder().encode(sourceText);
  const rangeOf = (needle: string) => {
    const from = new TextEncoder().encode(sourceText.slice(0, sourceText.indexOf(needle))).length;
    return { from, to: from + new TextEncoder().encode(needle).length };
  };
  const review: Review = { ...emptyReview(), edits: [
    { id: emptyLineId, before: 'X', after: '', anchor: makeAnchor(source, rangeOf('X')) },
    { id: tailId, before: 'УДАЛИТЬХВОСТ', after: '', anchor: makeAnchor(source, rangeOf('УДАЛИТЬХВОСТ')) },
  ] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const content = page.locator('.cm-content');
    const scroller = page.locator('.cm-scroller');
    const popup = page.getByRole('dialog', { name: 'Правка', exact: true });
    await expect(page.locator('.book__record')).toHaveCount(2);
    const docText = () => content.evaluate((element) => {
      const view = (element as HTMLElement & { cmTile: { root: { view: EditorView } } }).cmTile.root.view;
      return view.state.doc.toString();
    });
    const inViewport = async (id: string) => {
      const box = await content.locator(`[data-record-id="${id}"]`).boundingBox();
      const frame = await scroller.boundingBox();
      if (box === null || frame === null) return false;
      return box.y >= frame.y - 1 && box.y + box.height <= frame.y + frame.height + 1;
    };

    // Точка на пустой строке: попап открывается, текст и прокрутка живы.
    await page.getByRole('button', { name: 'Удаление: X →' }).click();
    await expect(popup).toBeVisible();
    expect(await docText()).toBe(derivedText);
    expect(await content.evaluate((element) => element.textContent ?? '')).toContain('Омега');
    await expect(content.locator(`[data-record-id="${emptyLineId}"]`)).toBeVisible();
    await expect.poll(() => inViewport(emptyLineId)).toBe(true);
    expect(Number.isFinite(await scroller.evaluate((element) => element.scrollTop))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);

    // Прокрутка не заклинила: следующая запись переезжает в другой край главы.
    await page.getByRole('button', { name: 'Удаление: УДАЛИТЬХВОСТ →' }).click();
    await expect(popup).toBeVisible();
    expect(await docText()).toBe(derivedText);
    await expect.poll(() => inViewport(tailId)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  } finally { await session.app.close(); }
});

test('older snapshot cannot replace accepted marker positions, including after theme changes', async () => {
  const bookRoot = await makeTempDir('galley-e2e-stale-markers-');
  const id = randomUUID();
  const sourceText = 'abc trailing';
  await writeBook(bookRoot, {...emptyReview(), edits: [{id, before: 'abc', after: 'abXc', anchor: makeAnchor(Buffer.from(sourceText), {from: 0, to: 3})}]});
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const manifest = JSON.parse(await readFile(path.join(bookRoot, '.pocket-editor.json'), 'utf8'));
  const session = await launch(bookRoot);
  try {
    const {page, app} = session;
    await openOwnBook(session);
    const old = await page.evaluate(async ({bookId, chapterId}) => window.desk.openChapter(bookId, chapterId), {bookId: manifest.book_id, chapterId: CHAPTER_ID});
    await selectFromStart(page, 1, 0);
    await page.keyboard.insertText('Y');
    await expect(page.locator('.gd-edit-range')).toHaveText('YbX');
    // Deliver an older render after the command ACK has raised expectedRevision.
    await app.evaluate(({BrowserWindow}, snapshot) => BrowserWindow.getAllWindows()[0]!.webContents.send('desk:snapshot', snapshot), old);
    await page.waitForTimeout(100);
    await expect(page.locator('.cm-content')).toContainText('aYbXc trailing');
    await expect(page.locator('.gd-edit-range')).toHaveText('YbX');
    const scheme = await page.locator('.book').evaluate(element => getComputedStyle(element).colorScheme);
    const nextScheme = scheme === 'dark' ? 'light' : 'dark';
    await page.getByRole('button', {name: 'Меню книги'}).click();
    await page.getByRole('button', {name: 'Оформление', exact: true}).click();
    await page.getByLabel('Тема', {exact: true}).selectOption(`gruvbox-${nextScheme}`);
    await expect.poll(() => page.locator('.book').evaluate(element => getComputedStyle(element).colorScheme)).toBe(nextScheme);
    await page.getByRole('button', {name: 'Закрыть оформление'}).click();
    await expect(page.locator('.gd-edit-range')).toHaveText('YbX');
    await page.getByRole('button', {name: /^Замена: abc/}).click();
    const selected = await page.locator('.cm-content').evaluate(element => {
      const view = (element as HTMLElement & {cmTile: {root: {view: EditorView}}}).cmTile.root.view;
      const {from, to} = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    });
    expect(selected).toBe('YbX');
  } finally { await session.app.close(); }
});

test('виды правок в списке: иконки плюс/минус/карандаш вместо слов «Было/Стало», полный aria-label остаётся', async () => {
  const bookRoot = await makeTempDir('galley-e2e-edit-kinds-');
  const sourceText = 'кот abc спит.\n';
  const source = new TextEncoder().encode(sourceText);
  const rangeOf = (needle: string) => {
    const from = new TextEncoder().encode(sourceText.slice(0, sourceText.indexOf(needle))).length;
    return { from, to: from + new TextEncoder().encode(needle).length };
  };
  const trimmedId = randomUUID();
  const review: Review = { ...emptyReview(), edits: [
    { id: randomUUID(), before: 'кот', after: 'кит', anchor: makeAnchor(source, rangeOf('кот')) },
    { id: randomUUID(), before: 'спит', after: '', anchor: makeAnchor(source, rangeOf('спит')) },
    // Общий префикс/суффикс: визуально '' → 'X', но классификация идёт по
    // исходной записи — replacement (карандаш), а не ложная вставка (плюс).
    { id: trimmedId, before: 'abc', after: 'abXc', anchor: makeAnchor(source, rangeOf('abc')) },
  ] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const replacement = page.getByRole('button', { name: 'Замена: кот → кит', exact: true });
    const deletion = page.getByRole('button', { name: /^Удаление: спит →/ });
    const trimmed = page.getByRole('button', { name: 'Замена: abc → abXc', exact: true });
    await expect(replacement).toHaveCount(1);
    await expect(deletion).toHaveCount(1);
    await expect(trimmed).toHaveCount(1);

    // Иконка по виду правки: pencil/minus/plus, скрытые от ассистивных технологий.
    await expect(replacement.locator('svg.tabler-icon-pencil')).toHaveCount(1);
    await expect(replacement.locator('svg.tabler-icon-minus')).toHaveCount(1);
    await expect(replacement.locator('svg.tabler-icon-plus')).toHaveCount(1);
    await expect(replacement.locator('svg.tabler-icon-pencil')).toHaveAttribute('aria-hidden', 'true');
    await expect(deletion.locator('svg.tabler-icon-minus')).toHaveCount(1);
    await expect(deletion.locator('svg.tabler-icon-pencil, svg.tabler-icon-plus')).toHaveCount(0);

    // Строки по виду правки: replacement — обе строки, deletion — только «Было»;
    // визуальная обрезка видна в содержимом (кот→кит даёт 'о'→'и').
    const replacementParts = replacement.locator('.book__record-part');
    await expect(replacementParts).toHaveCount(2);
    await expect(replacementParts.nth(0).locator('.book__record-excerpt')).toHaveText('о');
    await expect(replacementParts.nth(1).locator('.book__record-excerpt')).toHaveText('и');
    const deletionParts = deletion.locator('.book__record-part');
    await expect(deletionParts).toHaveCount(1);
    await expect(deletionParts.locator('.book__record-excerpt')).toHaveText('спит');
    // Обрезанная replacement показывает заполнитель пустой строки «Было».
    const trimmedParts = trimmed.locator('.book__record-part');
    await expect(trimmedParts).toHaveCount(2);
    await expect(trimmedParts.nth(0).locator('.book__record-excerpt')).toHaveText('вставка');
    await expect(trimmedParts.nth(1).locator('.book__record-excerpt')).toHaveText('X');
    // ...и её gutter-маркер остаётся карандашом «Правка», не плюсом.
    const trimmedMarker = page.locator(`.gd-review-gutter [data-record-id="${trimmedId}"]`);
    await expect(trimmedMarker).toHaveCount(1);
    await expect(trimmedMarker).toHaveAttribute('aria-label', 'Правка');
    await expect(trimmedMarker.locator('svg.tabler-icon-pencil')).toHaveCount(1);
    await expect(trimmedMarker.locator('svg.tabler-icon-plus')).toHaveCount(0);

    // Видимые слова «Было/Стало» убраны; удаление окрашено deletionColor.
    await expect(page.locator('.book__records')).not.toContainText('Было');
    await expect(page.locator('.book__records')).not.toContainText('Стало');
    expect(await deletion.locator('svg').evaluate((element) => getComputedStyle(element).color)).toBe('rgb(164, 46, 46)');
  } finally { await session.app.close(); }
});

test('стек маркеров одной строки: ширина gutter и текста неизменна, hover/Tab разворачивают, blur складывает', async () => {
  const bookRoot = await makeTempDir('galley-e2e-marker-stack-');
  const sourceText = 'один два три четыре пять\n';
  const source = new TextEncoder().encode(sourceText);
  const rangeOf = (needle: string) => {
    const from = new TextEncoder().encode(sourceText.slice(0, sourceText.indexOf(needle))).length;
    return { from, to: from + new TextEncoder().encode(needle).length };
  };
  const review: Review = { ...emptyReview(), edits: [
    { id: randomUUID(), before: 'два', after: 'дважды', anchor: makeAnchor(source, rangeOf('два')) },
    { id: randomUUID(), before: 'три', after: '', anchor: makeAnchor(source, rangeOf('три')) },
    { id: randomUUID(), before: 'четыре', after: 'четыре раза', anchor: makeAnchor(source, rangeOf('четыре')) },
    { id: randomUUID(), before: 'пять', after: 'пятёрка', anchor: makeAnchor(source, rangeOf('пять')) },
  ] };
  await writeBook(bookRoot, review);
  await writeFile(path.join(bookRoot, CHAPTER_PATH), sourceText);
  const session = await launch(bookRoot);
  try {
    const page = session.page;
    await openOwnBook(session);
    const content = page.locator('.cm-content');
    const markers = page.locator('.gd-review-gutter .gd-record-marker');
    await expect(markers).toHaveCount(4);
    const widths = () => page.evaluate(() => ({
      gutter: document.querySelector('.gd-review-gutter')!.getBoundingClientRect().width,
      content: document.querySelector('.cm-content')!.getBoundingClientRect().width,
    }));
    const lefts = () => page.evaluate(() => [...document.querySelectorAll('.gd-review-gutter .gd-record-marker')]
      .map((button) => parseFloat(getComputedStyle(button as HTMLElement).left)));
    const idle = await widths();
    // Фиксированный gutter: стек не расширяет колонку под маркеры
    // (было 4*24+8 = 104 px; допускаем суб-пиксельное округление хоста).
    expect(idle.gutter).toBeCloseTo(32, 0);
    await expect.poll(lefts).toEqual([0, 3, 6, 9]);

    // Hover разворачивает стек горизонтально поверх текста, ширины прежние.
    await markers.nth(0).hover();
    await expect.poll(lefts).toEqual([0, 24, 48, 72]);
    expect(await widths()).toEqual(idle);

    // Каждая кнопка доступна указателем: клик открывает попап записи.
    await markers.nth(2).click();
    await expect(page.getByRole('dialog', { name: 'Правка' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Правка' })).toHaveCount(0);

    // Уводим указатель: раскрытие держит только фокус (focus-within).
    await page.mouse.move(600, 500);
    await markers.nth(0).focus();
    await expect(markers.nth(0)).toBeFocused();
    for (let index = 1; index < 4; index++) {
      await page.keyboard.press('Tab');
      await expect(markers.nth(index)).toBeFocused();
    }
    await expect.poll(lefts).toEqual([0, 24, 48, 72]);

    // После blur стек снова сложен, ширины не изменились: reflow редактора нет.
    await content.focus();
    await expect.poll(lefts).toEqual([0, 3, 6, 9]);
    expect(await widths()).toEqual(idle);
  } finally { await session.app.close(); }
});
