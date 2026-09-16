import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { encodeReview, makeAnchor } from '@galley-desk/pocket-format';
import type { Edit, Review, Signal } from '@galley-desk/pocket-format';
import { createBookService } from './book-service';
import { IpcError } from './ipc';
import type { Snapshot } from '../shared/api';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Harness = ReturnType<typeof createBookService> & {
  bookRoot: string;
  appData: string;
  setPicker: (value: string | null) => void;
  setExportPicker: (value: string | null) => void;
  fireWatcher: () => void;
};

async function makeService(bookFiles: Record<string, string> = {}): Promise<Harness> {
  const bookRoot = await tempDir('galley-book-');
  for (const [name, content] of Object.entries(bookFiles)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const appData = await tempDir('galley-appdata-');
  let picked: string | null = bookRoot;
  let exportPicked: string | null = null;
  // Наблюдатель подменяется ручным триггером: тест сам решает, когда корень
  // «изменился», и не держит открытых файловых дескрипторов.
  const watcherEvents = new Map<string, () => void>();
  const service = createBookService({
    appData,
    chooseDirectory: async () => picked,
    chooseExportDestination: async () => exportPicked,
    watchRoot: (root, onEvent) => {
      watcherEvents.set(root, onEvent);
      return () => watcherEvents.delete(root);
    },
  });
  return Object.assign(service, {
    bookRoot,
    appData,
    setPicker(value: string | null) {
      picked = value;
    },
    setExportPicker(value: string | null) {
      exportPicked = value;
    },
    fireWatcher() {
      watcherEvents.get(bookRoot)?.();
    },
  }) as Harness;
}

function errorCode(error: unknown): string {
  expect(error).toBeInstanceOf(IpcError);
  return (error as IpcError).code;
}

async function writeSidecar(harness: Harness, chapterPath: string, review: Omit<Review, 'chapter_id' | 'source_path' | 'schema_version'>): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(harness.bookRoot, '.pocket-editor.json'), 'utf8')) as {
    chapters: Array<{ id: string; path: string }>;
  };
  const id = manifest.chapters.find((chapter) => chapter.path === chapterPath)!.id;
  const full: Review = { schema_version: 1, chapter_id: id, source_path: chapterPath, ...review };
  const sidecarPath = path.join(harness.bookRoot, chapterPath.replace(/\.md$/, '.review.json'));
  await writeFile(sidecarPath, encodeReview(full), 'utf8');
}


const utf8 = new TextEncoder();

/** Byte position of a substring's UTF-8 bytes (Uint8Array.indexOf is element-wise). */
function byteIndexOf(haystack: Uint8Array, needle: string): number {
  const pattern = utf8.encode(needle);
  outer: for (let start = 0; start + pattern.length <= haystack.length; start++) {
    for (let index = 0; index < pattern.length; index++) {
      if (haystack[start + index] !== pattern[index]) continue outer;
    }
    return start;
  }
  throw new Error(`Подстрока не найдена в исходнике: ${needle}`);
}


// Схема v1 требует UUID-形式的 идентификаторов записей.
const ID_EDIT_ACTIVE = '11111111-1111-4111-8111-111111111111';
const ID_SIGNAL_STALE = '22222222-2222-4222-8222-222222222222';
const ID_EDIT_A = '33333333-3333-4333-8333-333333333333';
const ID_EDIT_B = '44444444-4444-4444-8444-444444444444';
const ID_SIGNAL_1 = '55555555-5555-4555-8555-555555555555';
const ID_EDIT_APPLY = '66666666-6666-4666-8666-666666666666';

test('chooseBook без манифеста создаёт совместимый манифест без рекурсивного обхода', async () => {
  const harness = await makeService({
    'Глава 1.md': '# Одна\n',
    'Глава 2.md': '# Две\n',
  });
  await mkdir(path.join(harness.bookRoot, 'вложенная'), { recursive: true });
  await writeFile(path.join(harness.bookRoot, 'вложенная', 'глубокая.md'), '# Нет\n');

  const view = await harness.chooseBook();
  expect(view).not.toBeNull();
  expect(view!.entries.map((entry) => entry.path).sort()).toEqual(['Глава 1.md', 'Глава 2.md']);
  expect(view!.entries.every((entry) => !entry.missing)).toBe(true);
  expect(view!.title).toBe(path.basename(harness.bookRoot));

  const manifest = JSON.parse(await readFile(path.join(harness.bookRoot, '.pocket-editor.json'), 'utf8')) as {
    schema_version: number;
    book_id: string;
    chapters: unknown[];
  };
  expect(manifest.schema_version).toBe(1);
  expect(manifest.book_id).toBe(view!.bookId);
  expect(manifest.chapters).toHaveLength(2);

  const recents = await harness.recent();
  expect(recents).toHaveLength(1);
  expect(recents[0]!.missing).toBe(false);
});

test('отмена выбора папки возвращает null и ничего не открывает', async () => {
  const harness = await makeService({ 'Глава.md': '# Одна\n' });
  harness.setPicker(null);
  expect(await harness.chooseBook()).toBeNull();
  expect(await harness.recent()).toEqual([]);
});

test('команда text пишет только sidecar, инкрементирует ревизию и уведомляет слушателя', async () => {
  const source = 'кот спит.\n';
  const harness = await makeService({ 'Глава.md': source });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;

  // Редакция с правкой кот → кит создаётся обычным вводом через command.
  const snapshots: unknown[] = [];
  const unsubscribe = harness.subscribe((snapshot) => snapshots.push(snapshot));

  const initial = await harness.openChapter(view.bookId, chapterId);
  expect(initial.revision).toBe(1);
  expect(initial.text).toBe(source);
  expect(initial.sourceText).toBe(source);

  const from = initial.text.indexOf('кот');
  const updated = await harness.command(view.bookId, chapterId, initial.revision, {
    type: 'text',
    changes: [{ from, to: from + 3, insert: 'кит' }],
    selection: { anchor: from + 3, head: from + 3 },
  });
  expect(updated.revision).toBe(2);
  expect(updated.text).toBe('кит спит.\n');
  expect(updated.records[0]).toMatchObject({ kind: 'edit', status: 'active', before: 'кот', after: 'кит' });
  expect(updated.records[0]!.from).toBe(updated.text.indexOf('кит'));
  expect(updated.records[0]!.to).toBe(updated.text.indexOf('кит') + 3);
  expect(updated.canUndoInput).toBe(true);
  expect(updated.canRedoInput).toBe(false);

  // Исходник не тронут, правка живёт в sidecar.
  expect(await readFile(path.join(harness.bookRoot, 'Глава.md'), 'utf8')).toBe(source);
  const sidecar = await readFile(path.join(harness.bookRoot, 'Глава.review.json'), 'utf8');
  expect(sidecar).toContain('"after": "кит"');

  expect(snapshots).toHaveLength(1);
  unsubscribe();
  await harness.closeBook(view.bookId);
});

test('несовпадающая expectedRevision отклоняется с STALE_REVISION', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  await harness.openChapter(view.bookId, chapterId);
  const error = await harness
    .command(view.bookId, chapterId, 99, {
      type: 'text',
      changes: [{ from: 0, to: 3, insert: 'кит' }],
      selection: { anchor: 3, head: 3 },
    })
    .catch((caught) => caught);
  expect(errorCode(error)).toBe('STALE_REVISION');
  // Ничего не записано.
  expect(existsSync(path.join(harness.bookRoot, 'Глава.review.json'))).toBe(false);
});

test('пустой исходник даёт EMPTY_SOURCE, неизвестная глава — BOOK_MISSING', async () => {
  const harness = await makeService({ 'Пустая.md': '' });
  const view = (await harness.chooseBook())!;
  await harness.openChapter(view.bookId, view.entries[0]!.id);
  const empty = await harness
    .command(view.bookId, view.entries[0]!.id, 1, {
      type: 'text',
      changes: [{ from: 0, to: 0, insert: 'x' }],
      selection: { anchor: 0, head: 0 },
    })
    .catch((caught) => caught);
  expect(errorCode(empty)).toBe('EMPTY_SOURCE');

  const missing = await harness
    .openChapter(view.bookId, 'нет-такой-главы')
    .catch((caught) => caught);
  expect(errorCode(missing)).toBe('BOOK_MISSING');
});

test('битый sidecar открывается read-only и не перезаписывается', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  await harness.closeBook(view.bookId);
  await writeFile(path.join(harness.bookRoot, 'Глава.review.json'), '{ битый json', 'utf8');

  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  const snapshot = await harness.openChapter(reopened.bookId, reopened.entries[0]!.id);
  expect(snapshot.text).toBe('кот\n');
  expect(snapshot.records).toEqual([]);
  const command = await harness
    .command(view.bookId, view.entries[0]!.id, snapshot.revision, {
      type: 'note',
      text: 'нельзя',
    })
    .catch((caught) => caught);
  expect(errorCode(command)).toBe('UNAVAILABLE_RECORD');
  expect(await readFile(path.join(harness.bookRoot, 'Глава.review.json'), 'utf8')).toBe('{ битый json');
});

test('sidecar неизвестной версии открывается read-only, исходник сохраняется', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  await harness.closeBook(view.bookId);
  await writeFile(
    path.join(harness.bookRoot, 'Глава.review.json'),
    JSON.stringify({ schema_version: 2, chapter_id: view.entries[0]!.id, source_path: 'Глава.md', edits: [], signals: [] }),
    'utf8',
  );
  const before = await readFile(path.join(harness.bookRoot, 'Глава.review.json'), 'utf8');
  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  const snapshot = await harness.openChapter(reopened.bookId, reopened.entries[0]!.id);
  expect(snapshot.text).toBe('кот\n');
  expect(snapshot.records).toEqual([]);
  expect(await readFile(path.join(harness.bookRoot, 'Глава.review.json'), 'utf8')).toBe(before);
});

test('отсутствующий файл главы помечается missing и открывается пустым read-only', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  await harness.closeBook(view.bookId);
  await rm(path.join(harness.bookRoot, 'Глава.md'));

  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  expect(reopened.entries[0]!.missing).toBe(true);
  const snapshot = await harness.openChapter(view.bookId, view.entries[0]!.id);
  expect(snapshot.text).toBe('');
  const command = await harness
    .command(view.bookId, view.entries[0]!.id, snapshot.revision, { type: 'note', text: 'x' })
    .catch((caught) => caught);
  expect(errorCode(command)).toBe('UNAVAILABLE_RECORD');
});

test('openRecent принимает только путь из списка', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  await harness.chooseBook();
  const outside = await tempDir('galley-outside-');
  const outsideError = await harness.openRecent(outside).catch((caught) => caught);
  expect(errorCode(outsideError)).toBe('BOOK_MISSING');

  // Папка исчезла: запись сохраняется, открытие даёт BOOK_MISSING.
  const listed = (await harness.recent())[0]!.path;
  const movedRoot = `${harness.bookRoot}-переехала`;
  await rename(harness.bookRoot, movedRoot);
  harness.bookRoot = movedRoot;
  const missingError = await harness.openRecent(listed).catch((caught) => caught);
  expect(errorCode(missingError)).toBe('BOOK_MISSING');
  expect((await harness.recent())).toHaveLength(1);
});

test('повторный выбор переносившейся папки обновляет запись по book_id', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const first = (await harness.chooseBook())!;
  await harness.closeBook(first.bookId);
  const movedRoot = `${harness.bookRoot}-новое-место`;
  await rename(harness.bookRoot, movedRoot);
  harness.bookRoot = movedRoot;
  harness.setPicker(movedRoot);

  const reopened = await harness.chooseBook();
  expect(reopened!.bookId).toBe(first.bookId);
  const recents = await harness.recent();
  expect(recents).toHaveLength(1);
  expect(recents[0]!.path).toBe(movedRoot);
});

test('forgetRecent удаляет только запись, файлы остаются', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  await harness.chooseBook();
  const listed = (await harness.recent())[0]!.path;
  await harness.forgetRecent(listed);
  expect(await harness.recent()).toEqual([]);
  expect(existsSync(path.join(harness.bookRoot, 'Глава.md'))).toBe(true);
  expect(existsSync(path.join(harness.bookRoot, '.pocket-editor.json'))).toBe(true);
});

test('записи рецензии получают статусы и производные позиции', async () => {
  const source = 'кот спит.';
  const harness = await makeService({ 'Глава.md': source });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  await harness.closeBook(view.bookId);

  const bytes = utf8.encode(source);
  const catFrom = byteIndexOf(bytes, 'кот');
  const spiFrom = byteIndexOf(bytes, 'спи');
  const pitFrom = byteIndexOf(bytes, 'пит');

  const active: Edit = {
    id: ID_EDIT_ACTIVE,
    before: 'кот',
    after: 'кит',
    anchor: makeAnchor(bytes, { from: catFrom, to: catFrom + 6 }),
  };
  const stale: Signal = {
    id: ID_SIGNAL_STALE,
    type: 'note',
    selected_text: 'пёс',
    comment: 'исчез',
    anchor: makeAnchor(bytes, { from: catFrom, to: catFrom + 6 }),
  };
  // Пересекающиеся диапазоны: оба участника конфликтуют и не попадают в текст.
  const conflictingA: Edit = {
    id: ID_EDIT_A,
    before: 'спи',
    after: 'СПИ',
    anchor: makeAnchor(bytes, { from: spiFrom, to: spiFrom + 6 }),
  };
  const conflictingB: Edit = {
    id: ID_EDIT_B,
    before: 'пит',
    after: 'ПИТ',
    anchor: makeAnchor(bytes, { from: pitFrom, to: pitFrom + 6 }),
  };
  await writeSidecar(harness, 'Глава.md', {
    chapter_note: 'заметка главы',
    edits: [active, conflictingA, conflictingB],
    signals: [stale],
  });

  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  const snapshot = await harness.openChapter(reopened.bookId, chapterId);
  const byId = new Map(snapshot.records.map((record) => [record.id, record]));
  expect(snapshot.chapterNote).toBe('заметка главы');
  expect(snapshot.text).toBe('кит спит.');

  const activeView = byId.get(ID_EDIT_ACTIVE)!;
  expect(activeView).toMatchObject({ kind: 'edit', status: 'active', before: 'кот', after: 'кит', signalType: null, comment: '' });
  expect(activeView.from).toBe(snapshot.text.indexOf('кит'));
  expect(activeView.to).toBe(activeView.from! + 3);

  const staleView = byId.get(ID_SIGNAL_STALE)!;
  expect(staleView).toMatchObject({
    kind: 'signal',
    status: 'unavailable',
    reason: 'stale',
    from: null,
    to: null,
    before: 'пёс',
    after: '',
    comment: 'исчез',
    signalType: 'note',
  });

  expect(byId.get(ID_EDIT_A)).toMatchObject({ status: 'conflicting', from: null });
  expect(byId.get(ID_EDIT_B)).toMatchObject({ status: 'conflicting', from: null });
});

test('сигнал на исходном диапазоне получает производную позицию', async () => {
  const source = 'кот спит.';
  const harness = await makeService({ 'Глава.md': source });
  const view = (await harness.chooseBook())!;
  await harness.closeBook(view.bookId);
  const bytes = utf8.encode(source);
  const sleepsFrom = byteIndexOf(bytes, 'спит');
  await writeSidecar(harness, 'Глава.md', {
    chapter_note: '',
    edits: [],
    signals: [
      {
        id: ID_SIGNAL_1,
        type: 'warning',
        selected_text: 'спит',
        comment: 'неясно',
        anchor: makeAnchor(bytes, { from: sleepsFrom, to: sleepsFrom + 8 }),
      },
    ],
  });
  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  const snapshot = await harness.openChapter(reopened.bookId, view.entries[0]!.id);
  const signal = snapshot.records[0]!;
  expect(signal).toMatchObject({ kind: 'signal', status: 'active', before: 'спит', signalType: 'warning' });
  expect(signal.from).toBe(snapshot.text.indexOf('спит'));
  expect(signal.to).toBe(snapshot.text.indexOf('спит') + 4);
});

test('undo/redo флаги следуют истории применения', async () => {
  const harness = await makeService({ 'Глава.md': 'кот спит.' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  await harness.closeBook(view.bookId);
  const bytes = utf8.encode('кот спит.');
  await writeSidecar(harness, 'Глава.md', {
    chapter_note: '',
    edits: [
      {
        id: ID_EDIT_APPLY,
        before: 'кот',
        after: 'кит',
        anchor: makeAnchor(bytes, { from: 0, to: 6 }),
      },
    ],
    signals: [],
  });

  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  let snapshot = await harness.openChapter(reopened.bookId, chapterId);
  expect(snapshot.canUndoApply).toBe(false);
  snapshot = await harness.command(view.bookId, chapterId, snapshot.revision, { type: 'apply', id: ID_EDIT_APPLY });
  expect(snapshot.canUndoApply).toBe(true);
  expect(snapshot.canRedoApply).toBe(false);
  expect(snapshot.text).toBe('кит спит.');
  // Применение очищает историю обычного ввода — оба счётчика на нуле.
  expect(snapshot.canUndoInput).toBe(false);
  expect(snapshot.canRedoInput).toBe(false);
  snapshot = await harness.command(view.bookId, chapterId, snapshot.revision, { type: 'undo-apply' });
  expect(snapshot.canUndoApply).toBe(false);
  expect(snapshot.canRedoApply).toBe(true);
  // Undo/redo применения тоже очищают историю обычного ввода (session.ts).
  expect(snapshot.canUndoInput).toBe(false);
  expect(snapshot.canRedoInput).toBe(false);
  // Undo применения восстанавливает исходник и sidecar с правкой;
  // производный текст снова показывает исправление.
  expect(snapshot.sourceText).toBe('кот спит.');
  expect(snapshot.text).toBe('кит спит.');
  snapshot = await harness.command(view.bookId, chapterId, snapshot.revision, { type: 'redo-apply' });
  expect(snapshot.canUndoApply).toBe(true);
  expect(snapshot.canUndoInput).toBe(false);
  expect(snapshot.canRedoInput).toBe(false);
  expect(snapshot.sourceText).toBe('кит спит.');
  expect(snapshot.text).toBe('кит спит.');
  await harness.closeBook(view.bookId);
});

test('savePosition запоминает главу и прокрутку в appData', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n', 'Вторая.md': 'два\n' });
  const view = (await harness.chooseBook())!;
  await harness.savePosition(view.bookId, view.entries[1]!.id, 7, 320);
  const settings = JSON.parse(await readFile(path.join(harness.appData, 'settings.json'), 'utf8')) as {
    positions: Record<string, Record<string, { anchor: number; scrollTop: number }>>;
  };
  expect(settings.positions[view.bookId]![view.entries[1]!.id]).toEqual({ anchor: 7, scrollTop: 320 });
  const recents = JSON.parse(await readFile(path.join(harness.appData, 'recent-books.json'), 'utf8')) as Array<{
    lastChapterId: string | null;
    scrollTop: number | null;
  }>;
  expect(recents[0]!.lastChapterId).toBe(view.entries[1]!.id);
  expect(recents[0]!.scrollTop).toBe(320);
});

test('внешний вид хранит значения по умолчанию и проверяет границы', async () => {
  const harness = await makeService({});
  expect(await harness.appearance()).toEqual({
    themeId: 'auto',
    fontFamily: 'system-ui',
    fontSize: 16,
    lineWidth: 720,
  });
  await harness.setAppearance({ themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 19, lineWidth: 640 });
  expect((await harness.appearance()).fontSize).toBe(19);
  // Неизвестная тема отклоняется main (известен «auto» и каталог galley-themes).
  const rejectedTheme = await harness
    .setAppearance({ themeId: 'night', fontFamily: 'Lora', fontSize: 19, lineWidth: 640 })
    .catch((caught) => caught);
  expect(rejectedTheme).toBeInstanceOf(Error);
  const rejected = await harness
    .setAppearance({ themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 999, lineWidth: 640 })
    .catch((caught) => caught);
  expect(rejected).toBeInstanceOf(Error);
  expect((await harness.appearance()).fontSize).toBe(19);
});

test('closeBook дожидается записи и убирает книгу из реестра', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const snapshot = await harness.openChapter(view.bookId, chapterId);
  await harness.command(view.bookId, chapterId, snapshot.revision, {
    type: 'text',
    changes: [{ from: 0, to: 3, insert: 'кит' }],
    selection: { anchor: 3, head: 3 },
  });
  await harness.closeBook(view.bookId);
  expect(harness.getBookRoot(view.bookId)).toBeUndefined();
  expect(await readFile(path.join(harness.bookRoot, 'Глава.review.json'), 'utf8')).toContain('кит');
  // Повторное закрытие неизвестной книги безопасно.
  await harness.closeBook(view.bookId);
});

test('openChapter повторно возвращает ту же сессию с монотонной ревизией', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const first = await harness.openChapter(view.bookId, chapterId);
  const second = await harness.openChapter(view.bookId, chapterId);
  expect(second.revision).toBe(first.revision);
});

test('файловый список глав не содержит служебных и скрытых файлов', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n', '.pocket-editor.json.bak': 'мусор' });
  const view = (await harness.chooseBook())!;
  expect(view!.entries.map((entry) => entry.path)).toEqual(['Глава.md']);
});

// --- D3: группы ввода, внешний ввод, наблюдатель и разрешение изменений -----

test('две текстовые команды с одной группой сливаются в один undo-шаг', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const initial = await harness.openChapter(view.bookId, chapterId);

  const first = await harness.command(view.bookId, chapterId, initial.revision, {
    type: 'text',
    changes: [{ from: 3, to: 3, insert: '!' }],
    selection: { anchor: 4, head: 4 },
    group: 'burst-1',
  });
  const second = await harness.command(view.bookId, chapterId, first.revision, {
    type: 'text',
    changes: [{ from: 4, to: 4, insert: '?' }],
    selection: { anchor: 5, head: 5 },
    group: 'burst-1',
  });
  expect(second.text).toBe('кот!?\n');
  expect(second.canUndoInput).toBe(true);

  const undone = await harness.command(view.bookId, chapterId, second.revision, { type: 'undo-input' });
  // Один undo-шаг убирает всю пачку: доступны redo и пустой undo.
  expect(undone.text).toBe('кот\n');
  expect(undone.canRedoInput).toBe(true);
  expect(undone.canUndoInput).toBe(false);
  await harness.closeBook(view.bookId);
});

test('внешнее изменение перед записью отклоняет команду с STALE_REVISION без перезаписи', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const initial = await harness.openChapter(view.bookId, chapterId);
  const snapshots: unknown[] = [];
  harness.subscribe((snapshot) => snapshots.push(snapshot));

  await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'чужая версия', 'utf8');
  const error = await harness
    .command(view.bookId, chapterId, initial.revision, {
      type: 'text',
      changes: [{ from: 3, to: 3, insert: '!' }],
      selection: { anchor: 4, head: 4 },
    })
    .catch((caught) => caught);
  expect(errorCode(error)).toBe('STALE_REVISION');
  expect(await readFile(path.join(harness.bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');
  // Ревизия выросла, слушателю ушёл снимок внешнего текста.
  expect(snapshots).toHaveLength(1);
  const pushed = snapshots[0] as Snapshot;
  expect(pushed.revision).toBe(initial.revision + 1);
  expect(pushed.text).toBe('чужая версия');

  // Принятие внешней версии — не тупик: ввод снова работает поверх неё.
  const next = await harness.command(view.bookId, chapterId, pushed.revision, {
    type: 'text',
    changes: [{ from: 12, to: 12, insert: '!' }],
    selection: { anchor: 13, head: 13 },
  });
  expect(next.text).toBe('чужая версия!');
  await harness.closeBook(view.bookId);
});

test('recheckExternal молчит без изменений и уведомляет о внешней правке', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const initial = await harness.openChapter(view.bookId, chapterId);
  const edited = await harness.command(view.bookId, chapterId, initial.revision, {
    type: 'text',
    changes: [{ from: 3, to: 3, insert: '!' }],
    selection: { anchor: 4, head: 4 },
  });
  expect(edited.canUndoInput).toBe(true);

  const snapshots: Snapshot[] = [];
  harness.subscribe((snapshot) => snapshots.push(snapshot));

  // Неизменённая пара: короткое замыкание, уведомлений нет.
  await harness.recheckExternal();
  expect(snapshots).toHaveLength(0);

  await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'чужая версия', 'utf8');
  await harness.recheckExternal();
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]!.revision).toBe(edited.revision + 1);
  expect(snapshots[0]!.text).toBe('чужая версия');
  // Внешняя версия сбрасывает историю ввода сессии.
  expect(snapshots[0]!.canUndoInput).toBe(false);
  await harness.closeBook(view.bookId);
});

test('наблюдатель корня после debounce запускает проверку внешнего изменения', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  await harness.openChapter(view.bookId, chapterId);
  const snapshots: Snapshot[] = [];
  harness.subscribe((snapshot) => snapshots.push(snapshot));

  await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'внешняя правка', 'utf8');
  harness.fireWatcher();
  // Debounce 200 мс: уведомление приходит только после окна тишины.
  await vi.waitFor(() => {
    expect(snapshots).toHaveLength(1);
  }, { timeout: 2_000 });
  expect(snapshots[0]!.text).toBe('внешняя правка');
  await harness.closeBook(view.bookId);
});

test('resolveExternal принимает внешнюю версию и возвращает главу в работу', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const initial = await harness.openChapter(view.bookId, chapterId);
  const edited = await harness.command(view.bookId, chapterId, initial.revision, {
    type: 'text',
    changes: [{ from: 3, to: 3, insert: '!' }],
    selection: { anchor: 4, head: 4 },
  });
  expect(edited.canUndoInput).toBe(true);

  // Внешняя правка появляется и проверяется принудительно (фокус/наблюдатель).
  await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'чужая версия', 'utf8');

  // export-local с сохранённым черновиком: черновик выгружается в выбранное
  // назначение, внешняя версия становится базой, чужой файл не перезаписан.
  const draftReview = {
    schema_version: 1 as const,
    chapter_id: chapterId,
    source_path: 'Глава.md',
    chapter_note: 'черновик рецензии',
    edits: [],
    signals: [],
  };
  await writeFile(
    path.join(harness.appData, `${chapterId}.draft.json`),
    JSON.stringify({
      version: 1,
      chapter_id: chapterId,
      source_base64: Buffer.from('кот\n').toString('base64'),
      review: encodeReview(draftReview),
    }),
    'utf8',
  );
  const destination = path.join(harness.appData, 'выгрузка.review.json');
  harness.setExportPicker(destination);
  const resolved = await harness.resolveExternal(view.bookId, chapterId, 'export-local');
  expect(resolved.saveState).toBe('saved');
  expect(resolved.text).toBe('чужая версия');
  expect(resolved.revision).toBe(edited.revision + 1);
  // Истории сессии пусты: внешний вариант — новая база.
  expect(resolved.canUndoInput).toBe(false);
  expect(resolved.canRedoInput).toBe(false);
  expect(await readFile(destination, 'utf8')).toBe(encodeReview(draftReview));
  expect(await readFile(path.join(harness.bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');

  // Ввод снова работает поверх внешней версии; правки живут в sidecar.
  const resumed = await harness.command(view.bookId, chapterId, resolved.revision, {
    type: 'text',
    changes: [{ from: 12, to: 12, insert: '!' }],
    selection: { anchor: 13, head: 13 },
  });
  expect(resumed.text).toBe('чужая версия!');
  expect(await readFile(path.join(harness.bookRoot, 'Глава.md'), 'utf8')).toBe('чужая версия');

  // open-external после ещё одной внешней правки ведёт себя так же. Правка
  // '!' осталась в sidecar и переносится на новую базу движком.
  await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'вторая чужая', 'utf8');
  const reopened = await harness.resolveExternal(view.bookId, chapterId, 'open-external');
  expect(reopened.text).toBe('вт!орая чужая');
  expect(reopened.saveState).toBe('saved');
  await harness.closeBook(view.bookId);
});

test('closeAll дожидается всех сессий и убирает книги из реестра', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n', 'Вторая.md': 'два\n' });
  const view = (await harness.chooseBook())!;
  // Порядок глав отсортирован по имени файла — выбираем главу по пути.
  const chapter = view.entries.find((entry) => entry.path === 'Глава.md')!;
  const snapshot = await harness.openChapter(view.bookId, chapter.id);
  await harness.command(view.bookId, chapter.id, snapshot.revision, {
    type: 'text',
    changes: [{ from: 0, to: 3, insert: 'кит' }],
    selection: { anchor: 3, head: 3 },
  });
  await harness.closeAll();
  expect(harness.getBookRoot(view.bookId)).toBeUndefined();
  expect(await readFile(path.join(harness.bookRoot, 'Глава.review.json'), 'utf8')).toContain('кит');
});
