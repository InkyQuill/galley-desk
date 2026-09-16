import { mkdtemp, mkdir, realpath, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  // Match openBook roots even when tmpdir has a symlinked ancestor (macOS).
  return realpath(dir);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Harness = ReturnType<typeof createBookService> & {
  bookRoot: string;
  appData: string;
  setPicker: (value: string | null) => void;
  setPickerHandler: (handler: () => Promise<string | null>) => void;
  setExportPicker: (value: string | null) => void;
  fireWatcher: () => void;
};

async function makeService(bookFiles: Record<string, string> = {}, trashItem?: (target: string) => Promise<void>): Promise<Harness> {
  const bookRoot = await tempDir('galley-book-');
  for (const [name, content] of Object.entries(bookFiles)) {
    const target = path.join(bookRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const appData = await tempDir('galley-appdata-');
  let picked: string | null = bookRoot;
  let exportPicked: string | null = null;
  let pickerHandler = async () => picked;
  // Наблюдатель подменяется ручным триггером: тест сам решает, когда корень
  // «изменился», и не держит открытых файловых дескрипторов.
  const watcherEvents = new Map<string, () => void>();
  const service = createBookService({
    appData,
    ...(trashItem ? { trashItem } : {}),
    chooseDirectory: () => pickerHandler(),
    chooseExportDestination: async () => exportPicked,
    watchRoot: (root, onEvent) => {
      watcherEvents.set(root, onEvent);
      return () => watcherEvents.delete(root);
    },
  });
  return Object.assign(service, {
    bookRoot,
    appData,
    setPickerHandler(handler: () => Promise<string | null>) { pickerHandler = handler; },
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
const ID_SIGNAL_2 = '77777777-7777-4777-8777-777777777777';

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
  expect(snapshot.readOnlyReason).toBeTruthy();
  expect(snapshot.saveState).not.toBe('saved');
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
  expect(snapshot.readOnlyReason).toBeTruthy();
  expect(snapshot.saveState).not.toBe('saved');
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
  expect(snapshot.readOnlyReason).toBeTruthy();
  expect(snapshot.saveState).not.toBe('saved');
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

test('audit: changing a signal preserves id, history and unrelated records', async () => {
  const source = 'кот спит.';
  const harness = await makeService({ 'Глава.md': source });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  await harness.closeBook(view.bookId);
  const bytes = utf8.encode(source);
  await writeSidecar(harness, 'Глава.md', {
    chapter_note: '',
    edits: [{ id: ID_EDIT_ACTIVE, before: 'кот', after: 'кит', anchor: makeAnchor(bytes, { from: 0, to: 6 }) }],
    signals: [
      { id: ID_SIGNAL_1, type: 'note', selected_text: 'кот', comment: 'Первый', anchor: makeAnchor(bytes, { from: 0, to: 6 }) },
      { id: ID_SIGNAL_2, type: 'warning', selected_text: 'спит', comment: 'Другой', anchor: makeAnchor(bytes, { from: 7, to: 15 }) },
    ],
  });

  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  let snapshot = await harness.openChapter(reopened.bookId, chapterId);
  const target = snapshot.records.find((record) => record.id === ID_SIGNAL_1)!;
  snapshot = await harness.command(reopened.bookId, chapterId, snapshot.revision, {
    type: 'signal', id: ID_SIGNAL_1, from: target.from, to: target.to, signalType: 'review', comment: 'Обновлён',
  });
  expect(snapshot.records.find((record) => record.id === ID_SIGNAL_1)).toMatchObject({ signalType: 'review', comment: 'Обновлён' });
  expect(snapshot.records.map((record) => record.id).sort()).toEqual([ID_EDIT_ACTIVE, ID_SIGNAL_1, ID_SIGNAL_2].sort());

  snapshot = await harness.command(reopened.bookId, chapterId, snapshot.revision, { type: 'undo-input' });
  expect(snapshot.records.find((record) => record.id === ID_SIGNAL_1)).toMatchObject({ signalType: 'note', comment: 'Первый' });
  snapshot = await harness.command(reopened.bookId, chapterId, snapshot.revision, { type: 'redo-input' });
  expect(snapshot.records.find((record) => record.id === ID_SIGNAL_1)).toMatchObject({ signalType: 'review', comment: 'Обновлён' });

  await harness.closeBook(reopened.bookId);
  const openedAgain = await harness.openRecent((await harness.recent())[0]!.path);
  snapshot = await harness.openChapter(openedAgain.bookId, chapterId);
  expect(snapshot.records.find((record) => record.id === ID_SIGNAL_1)).toMatchObject({ signalType: 'review', comment: 'Обновлён' });
  expect(snapshot.records.map((record) => record.id).sort()).toEqual([ID_EDIT_ACTIVE, ID_SIGNAL_1, ID_SIGNAL_2].sort());
});

test('signal update rejects an edit id, an unknown id and an unavailable signal', async () => {
  const source = 'кот спит.';
  const harness = await makeService({ 'Глава.md': source });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  await harness.closeBook(view.bookId);
  const bytes = utf8.encode(source);
  const wrong = utf8.encode('другой текст');
  await writeSidecar(harness, 'Глава.md', {
    chapter_note: '',
    edits: [{ id: ID_EDIT_ACTIVE, before: 'кот', after: 'кит', anchor: makeAnchor(bytes, { from: 0, to: 6 }) }],
    signals: [{ id: ID_SIGNAL_STALE, type: 'note', selected_text: 'друг', comment: '', anchor: makeAnchor(wrong, { from: 0, to: 12 }) }],
  });
  const reopened = await harness.openRecent((await harness.recent())[0]!.path);
  const snapshot = await harness.openChapter(reopened.bookId, chapterId);
  for (const id of [ID_EDIT_ACTIVE, ID_SIGNAL_1, ID_SIGNAL_STALE]) {
    await expect(harness.command(reopened.bookId, chapterId, snapshot.revision, {
      type: 'signal', id, from: 0, to: 3, signalType: 'warning', comment: 'нет',
    })).rejects.toMatchObject({ code: 'UNAVAILABLE_RECORD' });
  }
  const unchanged = await harness.openChapter(reopened.bookId, chapterId);
  expect(unchanged.revision).toBe(snapshot.revision);
  expect(unchanged.records.map((record) => record.id).sort()).toEqual([ID_EDIT_ACTIVE, ID_SIGNAL_STALE].sort());
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
    fontFamily: 'Literata',
    fontSize: 18,
    uiFontFamily: 'Geist',
    uiFontSize: 13,
    lineWidth: 700,
  });
  await harness.setAppearance({ uiFontFamily: 'Geist', uiFontSize: 13, themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 19, lineWidth: 640 });
  expect((await harness.appearance()).fontSize).toBe(19);
  // Неизвестная тема отклоняется main (известен «auto» и каталог galley-themes).
  const rejectedTheme = await harness
    .setAppearance({ uiFontFamily: 'Geist', uiFontSize: 13, themeId: 'night', fontFamily: 'Lora', fontSize: 19, lineWidth: 640 })
    .catch((caught) => caught);
  expect(rejectedTheme).toBeInstanceOf(Error);
  const rejected = await harness
    .setAppearance({ uiFontFamily: 'Geist', uiFontSize: 13, themeId: 'galley-dark', fontFamily: 'Lora', fontSize: 999, lineWidth: 640 })
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


test('audit: failed close retains session and recoverable draft', async () => {
  const h = await makeService({ '01.md': 'cat', '02.md': 'second' });
  const v = (await h.chooseBook())!;
  const c = v.entries[0]!.id;
  const other = v.entries[1]!.id;
  const s = await h.openChapter(v.bookId, c);
  const o = await h.openChapter(v.bookId, other);
  await h.command(v.bookId, other, o.revision, { type: 'note', text: 'keep history' });
  await rename(h.appData, h.appData + '-moved');
  tempDirs.push(h.appData + '-moved');
  await writeFile(h.appData, 'blocked');
  await expect(h.command(v.bookId, c, s.revision, {
    type: 'text', changes: [{ from: 0, to: 3, insert: 'dog' }], selection: { anchor: 3, head: 3 },
  })).rejects.toThrow();
  await expect(h.closeBook(v.bookId)).rejects.toThrow();
  expect(h.getBookRoot(v.bookId)).toBe(h.bookRoot);
  expect((await h.openChapter(v.bookId, c)).saveState).toBe('error');
  expect((await h.openChapter(v.bookId, other)).canUndoInput).toBe(true);
  await rm(h.appData);
  await rename(h.appData + '-moved', h.appData);
  await expect(h.closeBook(v.bookId)).rejects.toThrow();
  const { readDrafts } = await import('@galley-desk/book-storage');
  expect((await readDrafts(h.appData)).find(draft => draft.id === c)?.pair.review).toContain('dog');
});


import { openBook, readPair, writePair, recoverBook, readJournalsForRoot, ChapterSession, acceptRecoveryExternal } from '@galley-desk/book-storage';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';

async function seedRecovery(h: Harness) {
  const book = await openBook(h.bookRoot);
  const c = book.manifest.chapters[0]!.id;
  const bytes = (s: string) => ({ base64: Buffer.from(s).toString('base64'), sha256: createHash('sha256').update(s).digest('hex') });
  const review = encodeReview({ schema_version: 1, chapter_id: c, source_path: '01.md', chapter_note: 'local note', edits: [], signals: [] });
  const record = { version: 1 as const, root: book.root, chapter_id: c, source_path: '01.md', review_path: '01.review.json', complete: false, before: { source: bytes('cat'), review: null }, after: { source: bytes('dog'), review: bytes(review) } };
  const name = 'galley-journal-' + createHash('sha256').update(book.root + '\n' + c).digest('hex').slice(0, 32) + '.json';
  await writeFile(path.join(h.appData, name), JSON.stringify(record));
  return { book, c, record, review };
}

test('audit: unresolved third revision must block new writes and preserve journal', async () => {
  const h = await makeService({ '01.md': 'cat' });
  const { book, c } = await seedRecovery(h);
  const journals = await readJournalsForRoot(h.appData, h.bookRoot);
  await writeFile(path.join(h.bookRoot, '01.md'), 'fox');
  expect(await recoverBook(book, h.appData)).toBe('external-change');
  const v = (await h.chooseBook())!;
  const s = await h.openChapter(v.bookId, c);
  await expect(h.command(v.bookId, c, s.revision, { type: 'note', text: 'new note' })).rejects.toMatchObject({ code: 'SAVE_FAILED' });
  expect(await readJournalsForRoot(h.appData, h.bookRoot)).toEqual(journals);
  expect(await readFile(path.join(h.bookRoot, '01.md'), 'utf8')).toBe('fox');
  expect(existsSync(path.join(h.bookRoot, '01.review.json'))).toBe(false);
  expect(s.recoveryConflict).toBe(true);
  expect(s.readOnlyReason).toBeTruthy();
  const current = await readPair(book, c);
  await expect(writePair(book, c, current.revision, current.pair, h.appData)).rejects.toThrow('Unresolved chapter recovery');
  expect(await readJournalsForRoot(h.appData, h.bookRoot)).toEqual(journals);
});


test.each(['open-external', 'export-local'] as const)('recovery %s preserves the exact local pair and journal before adopting external; reopen is clean', async choice => {
  const h = await makeService({ '01.md': 'cat' });
  const { c, record, review } = await seedRecovery(h);
  await writeFile(path.join(h.bookRoot, '01.md'), 'fox');
  const v = (await h.chooseBook())!;
  const snapshot = await h.openChapter(v.bookId, c);
  expect(snapshot.chapterNote).toBe('local note');
  const destination = await tempDir('galley-export-');
  await writeFile(path.join(destination, '01.md'), 'existing');
  h.setPicker(destination);
  const resolved = await h.resolveExternal(v.bookId, c, choice);
  expect(resolved.recoveryConflict).toBe(false);
  expect(resolved.text).toBe('fox');
  expect(await readJournalsForRoot(h.appData, h.bookRoot)).toEqual([]);
  const backups = path.join(h.appData, 'recovery-backups');
  const [name] = await readdir(backups);
  const backup = path.join(backups, name!);
  expect(await readFile(path.join(backup, '01.md'), 'utf8')).toBe('dog');
  expect(await readFile(path.join(backup, '01.review.json'), 'utf8')).toBe(review);
  expect(JSON.parse(await readFile(path.join(backup, 'recovery-journal.json'), 'utf8'))).toEqual(record);
  if (choice === 'export-local') {
    const directory = (await readdir(destination)).find(name => name.startsWith('galley-recovery-'))!;
    const copy = await openBook(path.join(destination, directory));
    expect(copy.id).toBe(v.bookId);
    expect(copy.manifest.chapters).toEqual((await openBook(h.bookRoot)).manifest.chapters);
    const session = await ChapterSession.open(copy, c, await tempDir('galley-copy-data-'));
    expect(session.model.text).toBe('dog');
    expect(session.model.review.chapter_note).toBe('local note');
    await session.close();
    expect(await readFile(path.join(destination, directory, '01.md'), 'utf8')).toBe('dog');
    expect(await readFile(path.join(destination, directory, '01.review.json'), 'utf8')).toBe(review);
    expect(JSON.parse(await readFile(path.join(destination, directory, 'recovery-journal.json'), 'utf8'))).toEqual(record);
  }
  expect(await readFile(path.join(destination, '01.md'), 'utf8')).toBe('existing');
  await h.closeBook(v.bookId);
  h.setPicker(h.bookRoot);
  await h.chooseBook();
  const reopened = await h.openChapter(v.bookId, c);
  expect(reopened.recoveryConflict).toBe(false);
  await expect(h.command(v.bookId, c, reopened.revision, { type: 'note', text: 'new' })).resolves.toMatchObject({ chapterNote: 'new' });
});

test.each(['cancel', 'export-failed', 'backup-failed'])('recovery %s keeps pending journal and blocks mutations', async failure => {
  const h = await makeService({ '01.md': 'cat' });
  const { c, record } = await seedRecovery(h);
  await writeFile(path.join(h.bookRoot, '01.md'), 'fox');
  const v = (await h.chooseBook())!;
  await h.openChapter(v.bookId, c);
  if (failure === 'cancel') {
    h.setPicker(null);
    expect((await h.resolveExternal(v.bookId, c, 'export-local')).recoveryConflict).toBe(true);
  } else {
    if (failure === 'export-failed') h.setPicker(path.join(h.bookRoot, '01.md'));
    else await writeFile(path.join(h.appData, 'recovery-backups'), 'blocked');
    await expect(h.resolveExternal(v.bookId, c, failure === 'export-failed' ? 'export-local' : 'open-external')).rejects.toMatchObject({ code: 'SAVE_FAILED' });
  }
  expect(await readJournalsForRoot(h.appData, h.bookRoot)).toEqual([record]);
  expect(await readFile(path.join(h.bookRoot, '01.md'), 'utf8')).toBe('fox');
  const snapshot = await h.openChapter(v.bookId, c);
  expect(snapshot.recoveryConflict).toBe(true);
  await expect(h.command(v.bookId, c, snapshot.revision, { type: 'note', text: 'blocked' })).rejects.toMatchObject({ code: 'SAVE_FAILED' });
});


test('deferred recovery picker cannot replace a newer session or reset its history', async () => {
  const h = await makeService({ '01.md': 'cat' });
  const { c, book, record } = await seedRecovery(h);
  await writeFile(path.join(h.bookRoot, '01.md'), 'fox');
  const v = (await h.chooseBook())!;
  await h.openChapter(v.bookId, c);
  let release!: (value: string) => void;
  let entered!: () => void;
  const enteredPicker = new Promise<void>(resolve => { entered = resolve; });
  h.setPickerHandler(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const first = h.resolveExternal(v.bookId, c, 'export-local');
  await enteredPicker;
  const second = h.resolveExternal(v.bookId, c, 'open-external').then(value => ({ value }), error => ({ error }));
  // Another owner resolves the original journal while this picker is pending.
  await acceptRecoveryExternal(book, c, h.appData, record);
  // Closing and reopening creates a newer live session with its own history.
  await h.closeBook(v.bookId);
  h.setPickerHandler(async () => h.bookRoot);
  await h.chooseBook();
  const live = await h.openChapter(v.bookId, c);
  const newer = await h.command(v.bookId, c, live.revision, { type: 'text', changes: [{ from: 0, to: 3, insert: 'wolf' }], selection: { anchor: 4, head: 4 } });
  expect(newer.canUndoInput).toBe(true);
  release(await tempDir('galley-late-export-'));
  await expect(first).rejects.toMatchObject({ code: 'STALE_REVISION' });
  expect(await second).toMatchObject({ error: { code: 'STALE_REVISION' } });
  expect(await h.openChapter(v.bookId, c)).toEqual(newer);
  const undone = await h.command(v.bookId, c, newer.revision, { type: 'undo-input' });
  expect(undone.text).toBe('fox');
});

test('identity refusal does not record a recent success or alter files', async () => {
  const h = await makeService({ 'Глава.md': 'кот\n', 'Глава.review.json': '{ broken' });
  await expect(h.chooseBook()).rejects.toThrow('Existing reviews require the original manifest');
  expect(await h.recent()).toEqual([]);
  expect(existsSync(path.join(h.bookRoot, '.pocket-editor.json'))).toBe(false);
  expect(await readFile(path.join(h.bookRoot, 'Глава.review.json'), 'utf8')).toBe('{ broken');
  expect(await readFile(path.join(h.bookRoot, 'Глава.md'), 'utf8')).toBe('кот\n');
});


test('watcher queued behind an own write does not advance revision or interrupt subsequent input', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const initial = await harness.openChapter(view.bookId, chapterId);
  const snapshots: Snapshot[] = [];
  harness.subscribe(snapshot => snapshots.push(snapshot));
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const storageBook = await vi.importActual<typeof import('@galley-desk/book-storage')>(
    '../../../../packages/book-storage/src/book',
  );
  const writePair = storageBook.writePair;
  const spy = vi.spyOn(storageBook, 'writePair').mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return writePair(...args);
  });
  try {
    const writing = harness.command(view.bookId, chapterId, initial.revision, {
      type: 'text', changes: [{ from: 3, to: 3, insert: '!' }], selection: { anchor: 4, head: 4 },
    });
    await started;
    const checking = harness.recheckExternal();
    release();
    const edited = await writing;
    await checking;
    expect(snapshots).toHaveLength(1);
    const next = await harness.command(view.bookId, chapterId, edited.revision, {
      type: 'text', changes: [{ from: 4, to: 4, insert: '?' }], selection: { anchor: 5, head: 5 },
    });
    expect(next.text).toBe('кот!?\n');
    expect(next.revision).toBe(initial.revision + 2);
    await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'external');
    await harness.recheckExternal();
    expect(snapshots).toHaveLength(3);
    expect(snapshots[2]!.revision).toBe(next.revision + 1);
    await expect(harness.command(view.bookId, chapterId, next.revision, {
      type: 'text', changes: [{ from: 0, to: 0, insert: 'lost' }], selection: { anchor: 4, head: 4 },
    })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(await readFile(path.join(harness.bookRoot, 'Глава.md'), 'utf8')).toBe('external');
  } finally {
    release();
    spy.mockRestore();
    await harness.closeBook(view.bookId);
  }
});

test('command preflight rejects an external adoption queued by the watcher ahead of it', async () => {
  const harness = await makeService({ 'Глава.md': 'кот\n' });
  const view = (await harness.chooseBook())!;
  const chapterId = view.entries[0]!.id;
  const initial = await harness.openChapter(view.bookId, chapterId);
  const snapshots: Snapshot[] = [];
  harness.subscribe(snapshot => snapshots.push(snapshot));
  await writeFile(path.join(harness.bookRoot, 'Глава.md'), 'external');
  const checking = harness.recheckExternal();
  const command = harness.command(view.bookId, chapterId, initial.revision, {
    type: 'text', changes: [{ from: 0, to: 0, insert: 'lost' }], selection: { anchor: 4, head: 4 },
  });
  await expect(command).rejects.toMatchObject({ code: 'STALE_REVISION' });
  await checking;
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]!.revision).toBe(initial.revision + 1);
  expect(await readFile(path.join(harness.bookRoot, 'Глава.md'), 'utf8')).toBe('external');
  await harness.closeBook(view.bookId);
});

test('metadata titles derive from existing source and save without changing manifest or body records',async()=>{
 const source='---\ntitle: Original\n---\nBody';
 const h=await makeService({'01.md':source});
 const book=(await h.chooseBook())!;
 expect(book.entries[0]!.title).toBe('Original');
 const id=book.entries[0]!.id;
 const manifestPath=path.join(h.bookRoot,'.pocket-editor.json');
 const manifest=await readFile(manifestPath,'utf8');
 const initial=await h.openChapter(book.bookId,id);
 const body=initial.text.indexOf('Body');
 const edited=await h.command(book.bookId,id,initial.revision,{type:'text',changes:[{from:body,to:body+4,insert:'Better'}],selection:{anchor:body+6,head:body+6}});
 const saved=await h.command(book.bookId,id,edited.revision,{type:'metadata',sourceText:source,yaml:'title: New name\nnested: {x: [1, 2]}\n'});
 expect(saved.title).toBe('New name');
 expect(saved.text).toContain('Better');
 expect(saved.sourceText).toBe('---\ntitle: New name\nnested: {x: [1, 2]}\n---\nBody');
 expect(saved.records).toHaveLength(1);
 expect(saved.records[0]!.status).toBe('active');
 expect(await readFile(manifestPath,'utf8')).toBe(manifest);
 await expect(h.command(book.bookId,id,saved.revision,{type:'metadata',sourceText:source,yaml:'title: stale'})).rejects.toMatchObject({code:'STALE_REVISION'});
 await expect(h.command(book.bookId,id,saved.revision,{type:'text',changes:[{from:0,to:1,insert:''}],selection:{anchor:0,head:0}})).rejects.toMatchObject({code:'UNAVAILABLE_RECORD'});
 await writeFile(path.join(h.bookRoot,'01.md'),'external');
 await expect(h.command(book.bookId,id,saved.revision,{type:'metadata',sourceText:saved.sourceText,yaml:'title: external conflict'})).rejects.toMatchObject({code:'STALE_REVISION'});
 expect(await readFile(path.join(h.bookRoot,'01.md'),'utf8')).toBe('external');
 await h.closeAll();
});

test.each(['\n', '\r\n'])('metadata save preserves BOM and exact source bytes with %j line endings', async eol => {
  const source = '\uFEFF' + ['---', 'title: Old', '---', 'Body 🐈', ''].join(eol);
  const h = await makeService({'01.md': source});
  const book = (await h.chooseBook())!;
  const id = book.entries[0]!.id;
  const initial = await h.openChapter(book.bookId, id);
  expect(initial.sourceText).toBe(source);
  const body = initial.text.indexOf('Body');
  const signalled = await h.command(book.bookId, id, initial.revision, {type:'signal',from:body,to:body+4,signalType:'note',comment:'keep'});
  expect(signalled.records[0]).toMatchObject({from:body,to:body+4,before:'Body'});
  const saved = await h.command(book.bookId, id, signalled.revision, {type:'metadata', sourceText:initial.sourceText, yaml:'title: New'});
  expect(saved.records[0]).toMatchObject({from:body,to:body+4,before:'Body',status:'active'});
  const expected = source.replace('title: Old', 'title: New');
  expect(saved.sourceText).toBe(expected);
  expect(await readFile(path.join(h.bookRoot, '01.md'))).toEqual(Buffer.from(expected));
  expect(saved.text).toBe(expected.slice(1).replace(/\r\n/g, '\n'));
  await h.closeAll();
});

test('adding metadata to BOM source retains exactly one BOM', async () => {
  const source = '\uFEFFBody 🐈\r\n';
  const h = await makeService({'01.md': source});
  const book = (await h.chooseBook())!;
  const id = book.entries[0]!.id;
  const initial = await h.openChapter(book.bookId, id);
  const saved = await h.command(book.bookId, id, initial.revision, {type:'metadata', sourceText:initial.sourceText, yaml:'title: New'});
  const expected = '\uFEFF---\r\ntitle: New\r\n---\r\nBody 🐈\r\n';
  expect(saved.sourceText).toBe(expected);
  expect(await readFile(path.join(h.bookRoot,'01.md'))).toEqual(Buffer.from(expected));
  await h.closeAll();
});

test('management drains pending edits, updates recent title, removes and re-adds intact review', async () => {
  const service = await makeService({'a.md':'Alpha body\n'});
  const book = (await service.chooseBook())!; const chapter=book.entries[0]!;
  const snap=await service.openChapter(book.bookId,chapter.id);
  const pending=service.command(book.bookId,chapter.id,snap.revision,{type:'text',changes:[{from:0,to:0,insert:'New '}],selection:{anchor:4,head:4}});
  await pending;
  const renamed=await service.manageBook(book.bookId,{type:'rename',title:'Renamed'});
  expect(renamed.title).toBe('Renamed'); expect((await service.recent())[0]!.title).toBe('Renamed');
  const saved=await readFile(path.join(service.bookRoot,'a.review.json'),'utf8');
  await service.manageBook(book.bookId,{type:'remove',chapterId:chapter.id});
  expect((await service.discoverChapters(book.bookId)).files.map(x=>x.path)).toEqual(['a.md']);
  const added=await service.manageBook(book.bookId,{type:'add',paths:['a.md']});
  expect(added.entries[0]!.id).toBe(chapter.id);
  expect((await service.openChapter(book.bookId,chapter.id)).text).toBe('New Alpha body\n');
  expect(await readFile(path.join(service.bookRoot,'a.review.json'),'utf8')).toBe(saved);
  await service.closeAll();
});

test('management rejects external manifest changes', async () => {
  const service=await makeService({'a.md':'Alpha body\n'}); const book=(await service.chooseBook())!;
  const manifest=path.join(service.bookRoot,'.pocket-editor.json');
  await writeFile(manifest,JSON.stringify({...JSON.parse(await readFile(manifest,'utf8')),title:'External'}));
  await expect(service.manageBook(book.bookId,{type:'rename',title:'Wrong'})).rejects.toMatchObject({code:'SAVE_FAILED'});
  expect(JSON.parse(await readFile(manifest,'utf8')).title).toBe('External');
  await service.closeAll();
});

test('management refuses a failed pending save and retains source and manifest', async () => {
 const service=await makeService({'a.md':'Alpha body\n'}); const book=(await service.chooseBook())!;
 const chapter=book.entries[0]!; const snap=await service.openChapter(book.bookId,chapter.id);
 const storage=await vi.importActual<typeof import('@galley-desk/book-storage')>('../../../../packages/book-storage/src/book');
 const spy=vi.spyOn(storage,'writePair').mockRejectedValueOnce(new Error('injected save failure'));
 try {
  await expect(service.command(book.bookId,chapter.id,snap.revision,{type:'text',changes:[{from:0,to:0,insert:'New '}],selection:{anchor:4,head:4}})).rejects.toThrow();
  await expect(service.manageBook(book.bookId,{type:'remove',chapterId:chapter.id})).rejects.toMatchObject({code:'SAVE_FAILED'});
  expect(JSON.parse(await readFile(path.join(service.bookRoot,'.pocket-editor.json'),'utf8')).chapters[0].id).toBe(chapter.id);
  expect(await readFile(path.join(service.bookRoot,'a.md'),'utf8')).toBe('Alpha body\n');
 } finally {spy.mockRestore(); await service.closeAll().catch(()=>undefined);}
});

test.each(['trash', 'manifest-conflict'] as const)('failed %s preserves a live chapter revision and undo history', async failure => {
  const h = await makeService({'a.md': 'Alpha body\n'});
  const book = (await h.chooseBook())!;
  const id = book.entries[0]!.id;
  let current = await h.openChapter(book.bookId, id);
  for (let i = 0; i < 4; i++) {
    current = await h.command(book.bookId, id, current.revision, {type:'text',changes:[{from:0,to:0,insert:'x'}],selection:{anchor:1,head:1}});
  }
  if (failure === 'manifest-conflict') {
    const manifest = path.join(h.bookRoot, '.pocket-editor.json');
    await writeFile(manifest, JSON.stringify({...JSON.parse(await readFile(manifest,'utf8')),title:'External'}));
  }
  await expect(h.manageBook(book.bookId, {type: failure === 'trash' ? 'trash' : 'remove',chapterId:id})).rejects.toMatchObject({code:'SAVE_FAILED'});
  // Do not reopen first: a rejected mutation must leave the mounted session usable.
  const typed = await h.command(book.bookId, id, current.revision, {type:'text',changes:[{from:0,to:0,insert:'y'}],selection:{anchor:1,head:1}});
  expect(typed.revision).toBeGreaterThan(current.revision);
  expect(typed.text).toBe('yxxxxAlpha body\n');
  const undo = await h.command(book.bookId, id, typed.revision, {type:'undo-input'});
  expect(undo.text).toBe(current.text);
  const earlierUndo = await h.command(book.bookId, id, undo.revision, {type:'undo-input'});
  expect(earlierUndo.text).toBe('xxxAlpha body\n');
  await h.closeAll();
});


test('partial trash replaces the missing chapter snapshot with a strictly newer revision', async () => {
  let calls=0;
  const h=await makeService({'a.md':'Alpha body\n'},async target=>{
    calls++;
    if(calls===2) throw Error('second trash failed');
    await rename(target,`${target}.trashed`);
  });
  const book=(await h.chooseBook())!; const id=book.entries[0]!.id;
  let current=await h.openChapter(book.bookId,id);
  for(let i=0;i<4;i++) current=await h.command(book.bookId,id,current.revision,{type:'text',changes:[{from:0,to:0,insert:'x'}],selection:{anchor:1,head:1}});
  const pushed:Snapshot[]=[]; h.subscribe(snapshot=>pushed.push(snapshot));
  await expect(h.manageBook(book.bookId,{type:'trash',chapterId:id})).rejects.toMatchObject({code:'SAVE_FAILED'});
  const missing=await h.openChapter(book.bookId,id);
  expect(missing.revision).toBeGreaterThan(current.revision);
  expect(missing.readOnlyReason).toContain('отсутствует');
  expect(missing.canUndoInput).toBe(false);
  expect(pushed.at(-1)).toEqual(missing);
  expect(JSON.parse(await readFile(path.join(h.bookRoot,'.pocket-editor.json'),'utf8')).chapters[0].id).toBe(id);
  await h.closeAll();
});

test('snapshot source title refreshes on apply and undo while suggestions retain the source title', async () => {
  const h = await makeService({ '01.md': '# Original\nBody' });
  const book = (await h.chooseBook())!;
  const id = book.entries[0]!.id;
  const initial = await h.openChapter(book.bookId, id);
  expect(initial.title).toBe('Original');
  const edited = await h.command(book.bookId, id, initial.revision, {
    type: 'text', changes: [{ from: 2, to: 10, insert: 'Changed' }], selection: { anchor: 9, head: 9 },
  });
  expect(edited.title).toBe('Original');
  const applied = await h.command(book.bookId, id, edited.revision, { type: 'apply', id: edited.records[0]!.id });
  expect(applied.title).toBe('Changed');
  expect(applied.sourceText).toBe('# Changed\nBody');
  const undone = await h.command(book.bookId, id, applied.revision, { type: 'undo-apply' });
  expect(undone.title).toBe('Original');
  expect(undone.sourceText).toBe('# Original\nBody');
  await h.closeAll();
});

test.each(['\n', '\r\n'])('source metadata remains protected when a Pocket edit hides its opening delimiter (%j)', async eol => {
  const source = '\uFEFF' + ['---', 'title: Книга 🐈', '---', 'Body'].join(eol);
  const h = await makeService({'01.md': source});
  const book = (await h.chooseBook())!;
  const id = book.entries[0]!.id;
  await writeSidecar(h, '01.md', {chapter_note: '', signals: [], edits: [{
    id: ID_EDIT_ACTIVE, before: '---', after: 'Hidden',
    anchor: makeAnchor(utf8.encode(source), {from: 3, to: 6}),
  }]});
  await h.closeBook(book.bookId);
  const reopened = await h.openRecent(h.bookRoot);
  const initial = await h.openChapter(reopened.bookId, id);
  expect(initial.text).toMatch(/^Hidden/);
  const metadata = initial.text.indexOf('title');
  await expect(h.command(book.bookId, id, initial.revision, {type: 'text', changes: [{from: metadata, to: metadata + 1, insert: 'X'}], selection: {anchor: metadata, head: metadata}})).rejects.toMatchObject({code: 'UNAVAILABLE_RECORD'});
  const body = initial.text.indexOf('Body');
  const edited = await h.command(book.bookId, id, initial.revision, {type: 'text', changes: [{from: body, to: body + 4, insert: 'Better'}], selection: {anchor: body + 6, head: body + 6}});
  expect(edited.text).toContain('Better');
  expect(await readFile(path.join(h.bookRoot, '01.md'), 'utf8')).toBe(source);
  await h.closeAll();
});

test('committed book management succeeds even when recent-list persistence fails', async () => {
  const h = await makeService({'01.md': 'Body'});
  const book = (await h.chooseBook())!;
  const recentPath = path.join(h.appData, 'recent-books.json');
  await rm(recentPath);
  await mkdir(recentPath); // Atomic recent-file rename fails, while book storage remains writable.
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const renamed = await h.manageBook(book.bookId, {type: 'rename', title: 'Committed title'});
    expect(renamed.title).toBe('Committed title');
    expect(JSON.parse(await readFile(path.join(h.bookRoot, '.pocket-editor.json'), 'utf8')).title).toBe('Committed title');
    expect(log).toHaveBeenCalledWith('[desk] manage-book: recent update failed');
  } finally {
    log.mockRestore();
    await rm(recentPath, {recursive: true});
    await h.closeAll();
  }
});
