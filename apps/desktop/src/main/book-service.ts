import { frontmatter, metadataReplacement, resolveTitle, sourceMetadata } from '../shared/metadata';
// Book service: the main-process owner of open books and chapter sessions.
// The renderer only ever sees BookView/Snapshot over typed IPC — no file
//system handles cross the boundary. Main owns the book-id registry, the
// monotonic per-chapter revisions and the serialized file actions of
// ChapterSession.
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  BookManagementError,
  manageBook as changeStoredBook,
  discoverChapters as discoverStoredChapters,
  ChapterSession,
  SaveQueue,
  acceptRecoveryExternal,
  preserveRecovery,
  readJournalsForRoot,
  decodeBytes,
  exportDraft,
  openBook,
  readPair,
  recoverBook,
  refreshManifest,
} from '@galley-desk/book-storage';
import type { BookHandle, ChapterSessionState, JournalRecord } from '@galley-desk/book-storage';
import { classifyReview, decodeReview } from '@galley-desk/pocket-format';
import type { Resolution } from '@galley-desk/pocket-format';
import { addSignal, openChapter as openChapterModel, removeRecord, setChapterNote, sourceRange } from '@galley-desk/review-engine';
import type { ChapterModel, Piece } from '@galley-desk/review-engine';
import type {
  AppearanceSettings,
  BookView,
  BookChange,
  ChapterDiscovery,
  Command,
  Entry,
  RecordView,
  Recent,
  Snapshot,
} from '../shared/api';
import type { LayoutSettings } from '../shared/layout';
import type { Logger } from './diagnostics/logger';
import { IpcError, toIpcError, validateCommand } from './ipc';
import {
  findRecentByCanonicalPath,
  forgetRecent as forgetRecentEntry,
  loadRecentBooks,
  saveRecentBooks,
  toRecentViews,
  updateRecentPosition,
  upsertRecent,
} from './recent-books';
import * as settings from './settings';

export type SnapshotListener = (snapshot: Snapshot) => void;

export type BookServiceDeps = {
  appData: string;
  /** Pause and drain renderer input before replacing open chapter sessions. */
  prepareBookRefresh?: (bookId: string) => Promise<{
    finish: (book: BookView) => Promise<void>;
    cancel: () => Promise<void>;
  }>;
  trashItem?: (absolutePath: string) => Promise<void>;
  /** Directory picker; null means the user cancelled. */
  chooseDirectory: () => Promise<string | null>;
  /** Save dialog for exporting a pending review draft; null means cancel. */
  chooseExportDestination: (suggestedName: string) => Promise<string | null>;
  /**
   * Watcher factory for an open book root; defaults to fs.watch. The watcher
   * is only a re-read signal (never proof of freshness) — it is debounced
   * here, and checks also run on focus and before every write.
   */
  watchRoot?: (root: string, onEvent: () => void) => () => void;
  /** Диагностический журнал; опционален (сбой создания логгера не блокирует книгу). */
  logger?: Logger;
};

/** Debounce of root watcher events before a re-read check runs. */
const WATCHER_DEBOUNCE_MS = 200;

function defaultWatchRoot(root: string, onEvent: () => void): () => void {
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { persistent: false }, () => onEvent());
  } catch {
    return () => undefined;
  }
  // Исчезновение папки книги — не ошибка приложения: наблюдатель замолкает.
  watcher.on('error', () => undefined);
  return () => {
    watcher.close();
  };
}

type LiveChapter = {
  kind: 'live';
  session: ChapterSession;
  revision: number;
};

/** Sidecar decode failure: the model shows the exact source, commands rejected. */
type ReadonlyChapter = {
  kind: 'readonly';
  model: ChapterModel;
  revision: number;
};

/** Source file missing: an empty read-only snapshot, never a written file. */
type MissingChapter = {
  kind: 'readonly-missing';
  revision: number;
};

type RecoveryChapter = { kind: 'recovery'; model: ChapterModel; record: JournalRecord; revision: number };
type ChapterEntry = LiveChapter | ReadonlyChapter | MissingChapter | RecoveryChapter;

type BookEntry = { handle: BookHandle; chapters: Map<string, ChapterEntry> };

export type BookService = {
  manageBook(bookId: string, change: BookChange): Promise<BookView>;
  discoverChapters(bookId: string): Promise<ChapterDiscovery>;
  appearance(): Promise<AppearanceSettings>;
  setAppearance(value: AppearanceSettings): Promise<void>;
  layout(): Promise<LayoutSettings>;
  setLayout(value: LayoutSettings): Promise<void>;
  savePosition(bookId: string, chapterId: string, anchor: number, scrollTop: number): Promise<void>;
  chooseBook(): Promise<BookView | null>;
  recent(): Promise<Recent[]>;
  openRecent(path: string): Promise<BookView>;
  forgetRecent(path: string): Promise<void>;
  openChapter(bookId: string, chapterId: string): Promise<Snapshot>;
  command(bookId: string, chapterId: string, expectedRevision: number, command: unknown): Promise<Snapshot>;
  closeBook(bookId: string): Promise<void>;
  resolveExternal(bookId: string, chapterId: string, choice: 'open-external' | 'export-local'): Promise<Snapshot>;
  /**
   * Internal: re-runs the external-change check for every live chapter of
   * every open book (window focus, watcher signal) and notifies the renderer
   * about the chapters whose pair actually changed.
   */
  recheckExternal(): Promise<void>;
  /**
   * Internal: closes every open book, waiting for each session to drain.
   * Used by before-quit; a failed flush is surfaced, never masked.
   */
  closeAll(): Promise<void>;
  /** Internal: snapshot push for the ipc layer (onSnapshot wiring). */
  subscribe(listener: SnapshotListener): () => void;
  subscribeBook(listener: (update: ChapterDiscovery) => void): () => void;
  /** Internal: resource protocol lookup of the open root by opaque book id. */
  getBookRoot(bookId: string): string | undefined;
};

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
// Raw source transport must retain BOM; engine-derived text keeps its own convention.
const sourceUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Состояние сессии читается через функцию: смена состояния происходит внутри
 * очереди (асинхронно), а control-flow narrowing TypeScript этого не видит.
 */
function stateOf(session: ChapterSession): ChapterSessionState {
  return session.state;
}

function emptyReview(chapterId: string, sourcePath: string): import('@galley-desk/pocket-format').Review {
  return { schema_version: 1, chapter_id: chapterId, source_path: sourcePath, chapter_note: '', edits: [], signals: [] };
}

// --- RecordView positions ----------------------------------------------------
//
// RecordView.from/to are derived-text UTF-16 positions. Active edits map to
// their own replacement piece; every other resolved range is translated back
// through the model's pieces (Piece[] carries exact source byte ranges and
// editId), the inverse of the engine's sourceRange — no engine changes.

type PieceSpan = { piece: Piece; start: number; end: number };

function pieceSpansOf(model: ChapterModel): PieceSpan[] {
  const spans: PieceSpan[] = [];
  let start = 0;
  for (const piece of model.pieces) {
    const end = start + piece.text.length;
    spans.push({ piece, start, end });
    start = end;
  }
  return spans;
}

/**
 * UTF-16 units of the derived text for a byte offset inside an unchanged
 * piece — the exact inverse of the engine's byteOffsetInSlice (CRLF collapses
 * into one LF output unit).
 */
function derivedUnitsForSliceByteOffset(slice: string, byteDelta: number): number {
  let units = 0;
  let bytes = 0;
  let index = 0;
  while (bytes < byteDelta && index < slice.length) {
    const code = slice.codePointAt(index);
    if (code === undefined) break;
    if (code === 0x0d) {
      const crlf = index + 1 < slice.length && slice.charCodeAt(index + 1) === 0x0a;
      bytes += crlf ? 2 : 1;
      units += 1;
      index += crlf ? 2 : 1;
    } else {
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      units += code > 0xffff ? 2 : 1;
      index += code > 0xffff ? 2 : 1;
    }
  }
  return units;
}

function boundaryDerivedPosition(spans: PieceSpan[], source: Uint8Array, byte: number, side: 'from' | 'to'): number {
  for (const { piece, start, end } of spans) {
    if (piece.editId !== undefined) {
      // Заменяющий кусок: границы внутри диапазона относятся к нему целиком.
      if (byte <= piece.source.from) return start;
      if (byte < piece.source.to) return side === 'from' ? start : end;
      continue;
    }
    if (byte < piece.source.to) {
      const slice = strictUtf8.decode(source.subarray(piece.source.from, piece.source.to));
      const from = piece.source.from;
      const bomBytes = source[from] === 0xef && source[from + 1] === 0xbb && source[from + 2] === 0xbf ? 3 : 0;
      return start + derivedUnitsForSliceByteOffset(slice, Math.max(0, byte - from - bomBytes));
    }
  }
  const last = spans[spans.length - 1];
  return last ? last.end : 0;
}

function derivedRangeForSourceRange(
  model: ChapterModel,
  fromByte: number,
  toByte: number,
): { from: number; to: number } {
  const spans = pieceSpansOf(model);
  return {
    from: boundaryDerivedPosition(spans, model.source, fromByte, 'from'),
    to: boundaryDerivedPosition(spans, model.source, toByte, 'to'),
  };
}

function unavailableReason(resolution: Resolution | undefined): string {
  if (resolution === undefined) return 'unavailable';
  if (resolution.kind === 'stale') return 'stale';
  if (resolution.kind === 'ambiguous') return `ambiguous (${resolution.candidates.length} candidates)`;
  return 'unavailable';
}

function buildRecordViews(model: ChapterModel): RecordView[] {
  const availability = classifyReview(model.source, model.review);
  const spans = pieceSpansOf(model);
  const records: RecordView[] = [];
  for (const edit of model.review.edits) {
    const base = { id: edit.id, kind: 'edit' as const, before: edit.before, after: edit.after, comment: '', signalType: null };
    if (availability.edits.has(edit.id)) {
      const span = spans.find((candidate) => candidate.piece.editId === edit.id);
      records.push({
        ...base,
        status: 'active',
        reason: '',
        from: span ? span.start : null,
        to: span ? span.end : null,
      });
    } else if (availability.conflicting.has(edit.id)) {
      records.push({ ...base, status: 'conflicting', reason: 'conflicting', from: null, to: null });
    } else {
      records.push({
        ...base,
        status: 'unavailable',
        reason: unavailableReason(availability.unavailable.get(edit.id)),
        from: null,
        to: null,
      });
    }
  }
  for (const signal of model.review.signals) {
    const base = {
      id: signal.id,
      kind: 'signal' as const,
      before: signal.selected_text,
      after: '',
      comment: signal.comment,
      signalType: signal.type,
    };
    const range = availability.signals.get(signal.id);
    if (range === undefined) {
      records.push({
        ...base,
        status: 'unavailable',
        reason: unavailableReason(availability.unavailable.get(signal.id)),
        from: null,
        to: null,
      });
    } else {
      const derived = derivedRangeForSourceRange(model, range.from, range.to);
      records.push({ ...base, status: 'active', reason: '', from: derived.from, to: derived.to });
    }
  }
  return records;
}

// --- service -----------------------------------------------------------------

export function createBookService(deps: BookServiceDeps): BookService {
  const managing = new Set<string>();
  const preparing = new Set<string>();
  const chapterLifecycles = new WeakMap<BookEntry, SaveQueue>();
  function chapterLifecycle(book: BookEntry): SaveQueue {
    let queue = chapterLifecycles.get(book);
    if (!queue) { queue = new SaveQueue(); chapterLifecycles.set(book, queue); }
    return queue;
  }
  const { appData } = deps;
  const watchRoot = deps.watchRoot ?? defaultWatchRoot;
  const books = new Map<string, BookEntry>();
  const resolutionQueues = new Map<string, SaveQueue>();
  const listeners = new Set<SnapshotListener>();
  const activeCommands = new Map<ChapterEntry, number>();
  const bookListeners = new Set<(update: ChapterDiscovery) => void>();
  const lastBookUpdates = new Map<string, string>();
  const rechecks = new Map<string, Promise<void>>();
  const watchers = new Map<string, () => void>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const notify = (snapshot: Snapshot): void => {
    for (const listener of [...listeners]) listener(snapshot);
  };

  // --- watcher ---------------------------------------------------------------

  /**
   * Наблюдатель за корнем книги — только сигнал перечитать: события
   * объединяются debounce-окном, а фактическую проверку выполняет
   * checkExternal сессии (короткое замыкание при неизменённых хэшах).
   */
  function watchBook(bookId: string, root: string): void {
    stopWatching(bookId);
    const unsubscribe = watchRoot(root, () => {
      const timer = debounceTimers.get(bookId);
      if (timer !== undefined) clearTimeout(timer);
      debounceTimers.set(
        bookId,
        setTimeout(() => {
          debounceTimers.delete(bookId);
          void recheckBook(bookId);
        }, WATCHER_DEBOUNCE_MS),
      );
    });
    watchers.set(bookId, unsubscribe);
  }

  function stopWatching(bookId: string): void {
    const timer = debounceTimers.get(bookId);
    if (timer !== undefined) {
      clearTimeout(timer);
      debounceTimers.delete(bookId);
    }
    const unsubscribe = watchers.get(bookId);
    if (unsubscribe !== undefined) {
      watchers.delete(bookId);
      unsubscribe();
    }
  }

  /** Перечитывает пары живых глав книги; уведомляет только об изменениях. */
  function recheckBook(bookId: string): Promise<void> {
    const pending = rechecks.get(bookId);
    if (pending) return pending;
    const task = checkBook(bookId).finally(() => rechecks.delete(bookId));
    rechecks.set(bookId, task);
    return task;
  }

  async function checkBook(bookId: string): Promise<void> {
    if (managing.has(bookId)) return;
    const book = books.get(bookId);
    if (book === undefined) return;
    let refreshError: string | undefined;
    const replaced = new Map<string, number>();
    let refreshing = false;
    let lease: Awaited<ReturnType<NonNullable<BookServiceDeps['prepareBookRefresh']>>> | undefined;
    let adopted = false;
    try {
      await chapterLifecycle(book).enqueue(async () => {
        await refreshManifest(book.handle, async next => {
          if (books.get(bookId) !== book) throw new BookManagementError('Книга уже закрыта.');
          if (managing.has(bookId)) throw new BookManagementError('Изменение книги ещё выполняется.');
          const affected = [...book.chapters].filter(([id]) => {
            const old = book.handle.manifest.chapters.find(chapter => chapter.id === id);
            return !next.chapters.some(chapter => chapter.id === id && chapter.path === old?.path);
          });
          if (affected.length > 0) {
            preparing.add(bookId);
            lease = await deps.prepareBookRefresh?.(bookId);
          }
          if (managing.has(bookId)) throw new BookManagementError('Изменение книги ещё выполняется.');
          managing.add(bookId);
          refreshing = true;
          for (const [, entry] of affected) {
            if (activeCommands.has(entry)) throw new BookManagementError('Дождитесь сохранения главы, чтобы обновить оглавление.');
            if (entry.kind === 'recovery') throw new BookManagementError('Сначала разрешите восстановление главы, чтобы обновить оглавление.');
            if (entry.kind === 'live') {
              await entry.session.flushPending();
              if (entry.session.state !== 'saved') throw new BookManagementError('Сначала разрешите внешнее изменение главы или ошибку сохранения, чтобы обновить оглавление.');
            }
          }
          for (const [id, entry] of affected) {
            if (entry.kind === 'live') await entry.session.close();
            replaced.set(id, entry.revision);
            book.chapters.delete(id);
          }
        });
        adopted = true;
        for (const [id, revision] of replaced) {
          const chapter = book.handle.manifest.chapters.find(chapter => chapter.id === id);
          if (!chapter) continue;
          const entry = await createChapterEntry(book.handle, id, chapter.path);
          entry.revision = revision + 1;
          book.chapters.set(id, entry);
          notify(snapshotOf(bookId, id, entry));
        }
      });
    } catch (error) {
      refreshError = error instanceof BookManagementError ? error.message : 'Не удалось обновить оглавление. Локальная работа сохранена.';
    } finally {
      if (refreshing) managing.delete(bookId);
      preparing.delete(bookId);
      if (lease) {
        try {
          if (adopted) await lease.finish(await bookView(book.handle));
          else await lease.cancel();
        } catch { refreshError = 'Не удалось завершить обновление оглавления. Локальная работа сохранена.'; }
      }
    }
    for (const [chapterId, entry] of book.chapters) {
      if (entry.kind !== 'live') continue;
      try {
        if (!await entry.session.checkExternal()) continue;
      } catch {
        // Черновик мог не сохраниться — состояние увидит следующая проверка.
        console.error('[desk] watcher: code=SAVE_FAILED');
        deps.logger?.write({ event: 'watcher-failed', level: 'warn', process: 'main', code: 'SAVE_FAILED' });
        continue;
      }
      // Ревизия сервиса растёт вместе с принятым изменением: устаревшие
      // expectedRevision рендера не проходят оптимистическую проверку.
      entry.revision += 1;
      notify(snapshotOf(bookId, chapterId, entry));
    }
    try {
      const files = refreshError ? [] : await discoverStoredChapters(book.handle);
      const key = JSON.stringify([book.handle.manifest, files, refreshError]);
      if (lastBookUpdates.get(bookId) !== key) {
        const update: ChapterDiscovery = {
          book: await bookView(book.handle), files,
          ...(refreshError ? { error: refreshError } : {}),
        };
        if (books.get(bookId) !== book) return;
        lastBookUpdates.set(bookId, key);
        for (const listener of bookListeners) listener(update);
      }
    } catch { /* Atomic replacement may still be in progress; retry on the next signal. */ }
  }

  /** Drains every session of the book and drops it from the registry. */
  async function closeBookById(bookId: string): Promise<void> {
    if (managing.has(bookId) || preparing.has(bookId)) throw new IpcError('SAVE_FAILED', 'Изменение книги ещё выполняется');
    const book = books.get(bookId);
    if (book === undefined) return;
    await Promise.all([...book.chapters.values()].map(async (entry) => {
      if (entry.kind === 'live') await entry.session.flushPending();
    }));
    for (const entry of book.chapters.values()) {
      if (entry.kind === 'live') await entry.session.close();
    }
    stopWatching(bookId);
    books.delete(bookId);
    lastBookUpdates.delete(bookId);
    book.chapters.clear();
  }

  function requireBook(bookId: string): BookEntry {
    const book = books.get(bookId);
    if (book === undefined) throw new IpcError('BOOK_MISSING', 'Книга не открыта');
    return book;
  }

  async function bookView(handle: BookHandle): Promise<BookView> {
    const entries: Entry[] = await Promise.all(
      handle.manifest.chapters.map(async (chapter) => ({
        id: chapter.id,
        path: chapter.path,
        title: await readPair(handle, chapter.id).then(({pair}) => resolveTitle(strictUtf8.decode(pair.source), chapter.title, chapter.path), () => chapter.title),
        missing: !(await isFile(path.join(handle.root, chapter.path))),
      })),
    );
    return { bookId: handle.id, path: handle.root, title: handle.manifest.title, entries };
  }

  async function openFolder(folder: string): Promise<BookView> {
    try {
      const handle = await openBook(folder);
      const recovery = await recoverBook(handle, appData);
      if (recovery === 'recovered') {
        console.error('[desk] open-book: код результата восстановления=recovered');
        deps.logger?.write({ event: 'recovery-result', level: 'info', process: 'main', code: 'recovered' });
      } else if (recovery === 'external-change') {
        console.error('[desk] open-book: восстановление отложено, код=SAVE_FAILED (внешнее изменение)');
        deps.logger?.write({ event: 'recovery-result', level: 'warn', process: 'main', code: 'external-change' });
      }
      // Уже открытая книга (например, папка переехала) переоткрывается начисто.
      if (books.has(handle.id)) {
        await closeBookById(handle.id);
      }
      books.set(handle.id, { handle, chapters: new Map() });
      watchBook(handle.id, handle.root);
      // openBook вернул realpath корня — канонический путь для списка последних.
      const stored = await loadRecentBooks(appData);
      await saveRecentBooks(
        appData,
        upsertRecent(stored, { path: handle.root, bookId: handle.id, title: handle.manifest.title }),
      );
      return await bookView(handle);
    } catch (error) {
      throw toIpcError(error);
    }
  }

  async function createChapterEntry(handle: BookHandle, chapterId: string, chapterPath: string): Promise<ChapterEntry> {
    const pending = (await readJournalsForRoot(appData, handle.root)).find(record => record.chapter_id === chapterId && !record.complete);
    if (pending !== undefined) {
      // Preview the local target without constructing a mutable session.
      const review = pending.after.review === null ? emptyReview(chapterId, chapterPath) : decodeReview(strictUtf8.decode(decodeBytes(pending.after.review)), chapterId, chapterPath);
      const model = openChapterModel(decodeBytes(pending.after.source), review);
      return { kind: 'recovery', model, record: pending, revision: 1 };
    }
    let pair: Awaited<ReturnType<typeof readPair>>;
    try {
      pair = await readPair(handle, chapterId);
    } catch {
      // Исходный файл отсутствует (или небезопасен): пустой read-only снимок,
      // пустой исходник никогда не пишется поверх файла.
      return { kind: 'readonly-missing', revision: 1 };
    }
    try {
      const session = await ChapterSession.open(handle, chapterId, appData);
      return { kind: 'live', session, revision: 1 };
    } catch {
      // Sidecar не декодируется (битый JSON, неизвестная версия): read-only
      // модель поверх точных исходных байтов; файл не перезаписывается.
      const model = openChapterModel(pair.pair.source, emptyReview(chapterId, chapterPath));
      return { kind: 'readonly', model, revision: 1 };
    }
  }

  function snapshotOf(bookId: string, chapterId: string, entry: ChapterEntry): Snapshot {
    const live = entry.kind === 'live' ? entry.session : null;
    const head = {
      bookId,
      chapterId,
      revision: entry.revision,
      recoveryConflict: entry.kind === 'recovery',
      readOnlyReason: entry.kind === 'live' ? null : entry.kind === 'recovery'
        ? 'Только чтение: Восстановление приостановлено. Сохраните локальную пару или откройте внешнюю версию.'
        : entry.kind === 'readonly-missing'
          ? 'Только чтение: файл главы отсутствует или недоступен.'
          : 'Только чтение: файл рецензии повреждён или имеет неподдерживаемый формат.',
      // Доступность undo/redo — истина движка (стеки сессии); сгруппированные
      // пачки набора считаются одним шагом, поэтому зеркала-счётчики удалены.
      canUndoInput: live?.canUndoInput ?? false,
      canRedoInput: live?.canRedoInput ?? false,
      canUndoApply: live?.canUndoApply ?? false,
      canRedoApply: live?.canRedoApply ?? false,
    };
    if (entry.kind === 'readonly-missing') {
      return {
        ...head,
        text: '',
        sourceText: '',
        records: [],
        chapterNote: '',
        saveState: 'error',
      };
    }
    const model = entry.kind === 'live' ? entry.session.model : entry.model;
    const chapter = requireBook(bookId).handle.manifest.chapters.find(candidate => candidate.id === chapterId);
    return {
      ...head,
      text: model.text,
      ...sourceMetadata(model.source, chapter?.title ?? '', chapter?.path ?? ''),
      records: buildRecordViews(model),
      chapterNote: model.review.chapter_note,
      saveState: entry.kind === 'recovery' ? 'external' : entry.kind === 'live' ? entry.session.state : 'error',
    };
  }

  const metadataEnds = new WeakMap<Uint8Array, number>();

  /**
   * Applies one validated command through the session. Undo/redo availability
   * is engine truth (the session's own history stacks) — grouped typing bursts
   * count as a single step, and an empty stack is a harmless no-op. A text
   * command carries the renderer's typing-burst group key.
   */
  async function applyCommand(entry: LiveChapter, command: Command): Promise<void> {
    const session = entry.session;
    switch (command.type) {
      case 'metadata': {
        if (sourceUtf8.decode(session.model.source) !== command.sourceText) throw new IpcError('STALE_REVISION', 'Исходник изменился; откройте метаданные заново');
        let prefix: string;
        try { prefix = metadataReplacement(command.sourceText, command.yaml); }
        catch (error) { throw new IpcError('SAVE_FAILED', error instanceof Error ? error.message : 'Ошибка YAML'); }
        try { await session.replaceSourcePrefix(command.sourceText, frontmatter(command.sourceText)?.byteEnd ?? (command.sourceText.startsWith('\uFEFF') ? 3 : 0), prefix); }
        catch (error) { if (error instanceof Error && error.message.includes('overlap')) throw new IpcError('UNAVAILABLE_RECORD','Сначала разрешите записи рецензии внутри метаданных'); throw error; }
        return;
      }
      case 'text': {
        // Imported suggestions may hide the delimiter in derived text. Protect
        // the original source bytes, mapping UTF-16 positions through pieces.
        let metadataEnd = metadataEnds.get(session.model.source);
        if (metadataEnd === undefined) {
          metadataEnd = frontmatter(sourceUtf8.decode(session.model.source))?.byteEnd ?? 0;
          metadataEnds.set(session.model.source, metadataEnd);
        }
        if (metadataEnd > 0 && command.changes.some(change => {
          if (sourceRange(session.model, change.from, change.to).from >= metadataEnd) return false;
          // A body-start insertion borrows the closing newline for its v1
          // anchor. Only permit its body portion when that entire metadata
          // prefix is still byte-derived and unchanged in the replacement.
          let position = 0;
          for (const piece of session.model.pieces) {
            const end = position + piece.text.length;
            if (piece.editId && piece.source.from < metadataEnd && piece.source.to >= metadataEnd && change.from >= position && change.from <= end) {
              const prefix = sourceUtf8.decode(session.model.source.subarray(piece.source.from, metadataEnd)).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
              if (piece.text.startsWith(prefix) && change.from >= position + prefix.length) return false;
            }
            position = end;
          }
          return true;
        })) throw new IpcError('UNAVAILABLE_RECORD','Используйте изменение метаданных');
        await session.edit(command.changes, command.selection, command.group);
        return;
      }
      case 'signal': {
        if (command.id !== undefined) {
          const isCurrentSignal = session.model.review.signals.some((signal) => signal.id === command.id);
          const isAvailable = classifyReview(session.model.source, session.model.review).signals.has(command.id);
          if (!isCurrentSignal || !isAvailable) {
            throw new IpcError('UNAVAILABLE_RECORD', 'Сигнал недоступен для изменения');
          }
        }
        const id = command.id ?? randomUUID();
        const withoutReplaced = command.id === undefined ? session.model : removeRecord(session.model, command.id);
        const next = addSignal(withoutReplaced, command.from, command.to, command.signalType, command.comment, id);
        await session.replaceReview(next.review);
        return;
      }
      case 'note':
        await session.replaceReview(setChapterNote(session.model, command.text).review);
        return;
      case 'remove':
        await session.replaceReview(removeRecord(session.model, command.id).review);
        return;
      case 'apply':
        await session.apply(command.id);
        return;
      case 'undo-input':
        if (session.canUndoInput) await session.undoInput();
        return;
      case 'redo-input':
        if (session.canRedoInput) await session.redoInput();
        return;
      case 'undo-apply':
        if (session.canUndoApply) await session.undoApply();
        return;
      case 'redo-apply':
        if (session.canRedoApply) await session.redoApply();
        return;
    }
  }

  return {
    async discoverChapters(bookId: string): Promise<ChapterDiscovery> {
      await recheckBook(bookId);
      const book = requireBook(bookId);
      try { return { book: await bookView(book.handle), files: await discoverStoredChapters(book.handle) }; }
      catch (error) { throw toIpcError(error); }
    },
    async manageBook(bookId: string, change: BookChange): Promise<BookView> {
      const book = requireBook(bookId);
      if (managing.has(bookId) || preparing.has(bookId)) throw new IpcError('SAVE_FAILED', 'Изменение книги ещё выполняется');
      managing.add(bookId);
      try {
        if ((await readJournalsForRoot(appData, book.handle.root)).some(record => !record.complete)) throw new IpcError('SAVE_FAILED', 'Сначала разрешите восстановление книги');
        for (const entry of book.chapters.values()) {
          if (entry.kind === 'live') {
            await entry.session.flushPending();
            if (entry.session.state === 'external' || entry.session.state === 'error') throw new IpcError('SAVE_FAILED', 'Сначала разрешите внешнее изменение или ошибку сохранения');
          }
        }
        // Keep the mounted session and undo history until the operation succeeds.
        // Validation and first-trash failures leave both files untouched.
        try {
          await changeStoredBook(book.handle, change, deps.trashItem);
        } catch (error) {
          if (change.type === 'trash' && error instanceof BookManagementError && error.filesMoved) {
            const previous = book.chapters.get(change.chapterId);
            const chapter = book.handle.manifest.chapters.find(chapter => chapter.id === change.chapterId)!;
            const next = await createChapterEntry(book.handle, change.chapterId, chapter.path);
            next.revision = (previous?.revision ?? 0) + 1;
            if (previous?.kind === 'live') await previous.session.close();
            book.chapters.set(change.chapterId, next);
            notify(snapshotOf(bookId, change.chapterId, next));
          }
          throw error;
        }
        if (change.type === 'remove' || change.type === 'trash') {
          const entry = book.chapters.get(change.chapterId);
          if (entry?.kind === 'live') await entry.session.close();
          book.chapters.delete(change.chapterId);
        }
        const view = await bookView(book.handle);
        // The book operation is already committed; failure to update this local
        // convenience list must not invite repeating a successful file action.
        try {
          const stored = await loadRecentBooks(appData);
          await saveRecentBooks(appData, upsertRecent(stored, { path: book.handle.root, bookId, title: book.handle.manifest.title }));
        } catch {
          console.error('[desk] manage-book: recent update failed');
          deps.logger?.write({ event: 'recent-update-failed', level: 'warn', process: 'main' });
        }
        return view;
      } catch (error) { throw toIpcError(error); }
      finally { managing.delete(bookId); }
    },
    async appearance(): Promise<AppearanceSettings> {
      return (await settings.loadSettings(appData)).appearance;
    },

    async setAppearance(value: AppearanceSettings): Promise<void> {
      // Сообщения validateAppearance — безопасные константы (границы, тема),
      // поэтому через IpcError они доходят до панели оформления как причина.
      let validated: AppearanceSettings;
      try {
        validated = settings.validateAppearance(value);
      } catch (cause) {
        throw new IpcError(
          'SAVE_FAILED',
          cause instanceof Error ? cause.message : 'Настройки оформления не приняты',
        );
      }
      await settings.saveAppearance(appData, validated);
    },

    async layout(): Promise<LayoutSettings> {
      return (await settings.loadSettings(appData)).layout;
    },

    async setLayout(value: LayoutSettings): Promise<void> {
      let validated: LayoutSettings;
      try {
        validated = settings.validateLayout(value);
      } catch (cause) {
        throw new IpcError(
          'SAVE_FAILED',
          cause instanceof Error ? cause.message : 'Настройки ширины не приняты',
        );
      }
      await settings.saveLayout(appData, validated);
    },

    async savePosition(bookId: string, chapterId: string, anchor: number, scrollTop: number): Promise<void> {
      if (!Number.isSafeInteger(anchor) || anchor < 0 || !Number.isSafeInteger(scrollTop) || scrollTop < 0) {
        throw new IpcError('SAVE_FAILED', 'Некорректная позиция чтения');
      }
      if (typeof bookId !== 'string' || bookId.length === 0 || typeof chapterId !== 'string' || chapterId.length === 0) {
        throw new IpcError('BOOK_MISSING', 'Некорректный идентификатор');
      }
      await settings.savePosition(appData, bookId, chapterId, anchor, scrollTop);
      // Последняя глава и прокрутка также живут в записи последних книг.
      const book = books.get(bookId);
      if (book === undefined) return;
      const stored = await loadRecentBooks(appData);
      await saveRecentBooks(appData, updateRecentPosition(stored, bookId, chapterId, anchor, scrollTop));
    },

    async chooseBook(): Promise<BookView | null> {
      const folder = await deps.chooseDirectory();
      if (folder === null) return null;
      return openFolder(folder);
    },

    async recent(): Promise<Recent[]> {
      const stored = await loadRecentBooks(appData);
      return toRecentViews(stored);
    },

    async openRecent(requested: string): Promise<BookView> {
      const stored = await loadRecentBooks(appData);
      const entry = await findRecentByCanonicalPath(stored, requested);
      // Принимаются только пути из списка; смена пути — новый picker.
      if (entry === undefined) {
        throw new IpcError('BOOK_MISSING', 'Этого пути нет в списке последних книг');
      }
      if (!(await isDirectory(entry.path))) {
        throw new IpcError('BOOK_MISSING', 'Папка книги недоступна; запись сохранена');
      }
      return openFolder(entry.path);
    },

    async forgetRecent(requested: string): Promise<void> {
      const stored = await loadRecentBooks(appData);
      const entry = await findRecentByCanonicalPath(stored, requested);
      if (entry === undefined) return;
      // Удаляется только запись списка — файлы книги не затрагиваются.
      await saveRecentBooks(appData, forgetRecentEntry(stored, requested, entry.path));
    },

    async openChapter(bookId: string, chapterId: string): Promise<Snapshot> {
      const book = requireBook(bookId);
      return chapterLifecycle(book).enqueue(async () => {
        if (books.get(bookId) !== book) throw new IpcError('BOOK_MISSING', 'Книга уже закрыта');
        if (managing.has(bookId)) throw new IpcError('SAVE_FAILED', 'Изменение книги ещё выполняется');
        const chapter = book.handle.manifest.chapters.find(candidate => candidate.id === chapterId);
        if (!chapter) throw new IpcError('BOOK_MISSING', 'Глава отсутствует в манифесте книги');
        let entry = book.chapters.get(chapterId);
        if (!entry) {
          entry = await createChapterEntry(book.handle, chapterId, chapter.path);
          book.chapters.set(chapterId, entry);
        }
        return snapshotOf(bookId, chapterId, entry);
      });
    },

    async command(
      bookId: string,
      chapterId: string,
      expectedRevision: number,
      command: unknown,
    ): Promise<Snapshot> {
      const book = requireBook(bookId);
      if (managing.has(bookId)) throw new IpcError('SAVE_FAILED', 'Изменение книги ещё выполняется');
      const entry = book.chapters.get(chapterId);
      if (entry === undefined) {
        throw new IpcError('BOOK_MISSING', 'Глава ещё не открыта');
      }
      if (entry.kind === 'recovery') throw new IpcError('SAVE_FAILED', 'Незавершённое восстановление: сохраните локальную пару или откройте внешнюю версию');
      if (entry.kind !== 'live') {
        throw new IpcError('UNAVAILABLE_RECORD', 'Глава открыта только для чтения: записи недоступны');
      }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new IpcError('STALE_REVISION', 'Некорректный номер ревизии');
      }
      if (expectedRevision !== entry.revision) {
        // Устаревший optimistic state не применяется: snapshot не возвращается.
        throw new IpcError('STALE_REVISION', 'Снимок устарел; перечитайте главу');
      }
      if (entry.session.state === 'external') {
        throw new IpcError('STALE_REVISION', 'Глава изменена снаружи; разрешите изменение перед вводом');
      }
      if (entry.session.state === 'error') {
        throw new IpcError('SAVE_FAILED', 'Предыдущее сохранение не удалось; перечитайте главу');
      }
      activeCommands.set(entry, (activeCommands.get(entry) ?? 0) + 1);
      try {
        // Проверка внешнего изменения перед записью: неизменённая пара —
        // дешёвый no-op (короткое замыкание сессии); изменившаяся — принятие
        // внешней версии и отказ команды: никакого silent rebase локального
        // ввода поверх чужого текста. Жёсткую гарантию всё равно даёт
        // writePair (WriteConflictError с сохранением черновика).
        const externalChanged = await entry.session.checkExternal();
        if (externalChanged) {
          entry.revision += 1;
          notify(snapshotOf(bookId, chapterId, entry));
        }
        if (externalChanged || stateOf(entry.session) === 'external' || expectedRevision !== entry.revision) {
          throw new IpcError('STALE_REVISION', 'Глава изменена снаружи; разрешите изменение перед вводом');
        }
        // Ошибки хранения (конфликт записи, пустой исходник, неактивная запись)
        // маппируются на стабильные коды здесь, а не на границе IPC.
        const validated = validateCommand(command);
        await applyCommand(entry, validated);
      } catch (error) {
        throw toIpcError(error);
      } finally {
        const remaining = (activeCommands.get(entry) ?? 1) - 1;
        if (remaining) activeCommands.set(entry, remaining);
        else activeCommands.delete(entry);
      }
      entry.revision += 1;
      const snapshot = snapshotOf(bookId, chapterId, entry);
      notify(snapshot);
      return snapshot;
    },

    async closeBook(bookId: string): Promise<void> {
      await closeBookById(bookId);
    },

    async resolveExternal(
      bookId: string,
      chapterId: string,
      choice: 'open-external' | 'export-local',
    ): Promise<Snapshot> {
      const book = requireBook(bookId);
      const entry = book.chapters.get(chapterId);
      const key = `${bookId}\n${chapterId}`;
      let queue = resolutionQueues.get(key);
      if (queue === undefined) {
        queue = new SaveQueue();
        resolutionQueues.set(key, queue);
      }
      const assertCurrentEntry = () => {
        if (books.get(bookId) !== book || book.chapters.get(chapterId) !== entry) {
          throw new IpcError('STALE_REVISION', 'Состояние восстановления изменилось; перечитайте главу');
        }
      };
      return queue.enqueue(async () => {
        assertCurrentEntry();
        if (entry?.kind === 'recovery') {
          try {
            if (choice === 'export-local') {
              const parent = await deps.chooseDirectory();
              assertCurrentEntry();
              if (parent === null) return snapshotOf(bookId, chapterId, entry);
              // A fresh child directory avoids replacing any existing pair.
              await preserveRecovery(entry.record, parent, book.handle);
            }
            assertCurrentEntry();
            await acceptRecoveryExternal(book.handle, chapterId, appData, entry.record);
            const chapter = book.handle.manifest.chapters.find(chapter => chapter.id === chapterId)!;
            const next = await createChapterEntry(book.handle, chapterId, chapter.path);
            assertCurrentEntry();
            next.revision = entry.revision + 1;
            book.chapters.set(chapterId, next);
            const snapshot = snapshotOf(bookId, chapterId, next);
            notify(snapshot);
            return snapshot;
          } catch (error) { throw toIpcError(error); }
        }
        if (entry === undefined || entry.kind !== 'live') {
          throw new IpcError('UNAVAILABLE_RECORD', 'Глава недоступна для разрешения внешнего изменения');
        }
        // checkExternal сохраняет локальный черновик в appData при необходимости.
        try {
          await entry.session.checkExternal();
          if (choice === 'export-local') {
            const chapter = book.handle.manifest.chapters.find((candidate) => candidate.id === chapterId);
            const suggested = `${chapter === undefined ? chapterId : path.basename(chapter.path, '.md')}.review.json`;
            const destination = await deps.chooseExportDestination(suggested);
            if (destination === null) {
              // Выбор отменён: черновик остаётся в appData, глава остаётся
              // приостановленной — никакого авто-затирания и авто-принятия.
              return snapshotOf(bookId, chapterId, entry);
            }
            await exportDraft(appData, chapterId, destination);
          }
          // Внешняя версия становится рабочей базой; истории движка пусты.
          await entry.session.adoptExternal();
        } catch (error) {
          throw toIpcError(error);
        }
        entry.revision += 1;
        const snapshot = snapshotOf(bookId, chapterId, entry);
        notify(snapshot);
        return snapshot;
      });
    },

    async recheckExternal(): Promise<void> {
      for (const bookId of [...books.keys()]) {
        await recheckBook(bookId);
      }
    },

    async closeAll(): Promise<void> {
      await Promise.all([...books.values()].flatMap(book => [...book.chapters.values()].map(async entry => {
        if (entry.kind === 'live') await entry.session.flushPending();
      })));
      for (const bookId of [...books.keys()]) {
        await closeBookById(bookId);
      }
    },

    subscribeBook(listener: (update: ChapterDiscovery) => void): () => void {
      bookListeners.add(listener);
      return () => { bookListeners.delete(listener); };
    },

    subscribe(listener: SnapshotListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getBookRoot(bookId: string): string | undefined {
      return books.get(bookId)?.handle.root;
    },
  };
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
