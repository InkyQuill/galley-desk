import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { decodeManifest, decodeReview, discover, encodeManifest } from '@galley-desk/pocket-format';
import type { Chapter, Manifest } from '@galley-desk/pocket-format';
import {
  assertDirectChildName,
  assertWritableFileTarget,
  fsyncDir,
  listOrdinaryFiles,
  readFileBytes,
  readOptionalFileBytes,
  renameFileSynced,
  replaceFileSynced,
  sha256Hex,
  unlinkIfPresent,
  utf8Bytes,
  utf8Text,
  UnsafePathError,
  writeTempSibling,
  writeFileSynced,
} from './files';
import {
  decodeBytes,
  encodeBytes,
  markJournalComplete,
  readJournalsForRoot,
  removeJournal,
  writeJournal,
} from './journal';
import type { JournalRecord, JournalSide } from './journal';
import { SaveQueue } from './save-queue';

/** Content identity of a chapter pair as last read or written. */
export type Revision = { sourceHash: string; reviewHash: string | null };

/** Exact source bytes plus the sidecar JSON string (`null` when absent). */
export type Pair = { source: Uint8Array; review: string | null };

export type BookHandle = { id: string; root: string; manifest: Manifest };

const MANIFEST_NAME = '.pocket-editor.json';
const manifestBytes = new WeakMap<BookHandle, Uint8Array>();
const managementQueues = new Map<string, SaveQueue>();

/**
 * Thrown by {@link openBook} when reviews exist without their original manifest,
 * or when `.pocket-editor.json` exists but cannot be
 * decoded as a supported manifest — v1, or v2 read tolerantly (a structurally
 * broken file, for example a bad UUID, or an unknown `schema_version`). This
 * is a read-only identity error: the manifest file is never overwritten,
 * upgraded or replaced. Callers should surface the message and `error.cause`
 * (the underlying decoder error) to the user.
 */
export class ManifestError extends Error {
  readonly manifestPath: string;

  constructor(manifestPath: string, cause: unknown) {
    super(
      `Book manifest ${manifestPath} cannot be decoded as a supported manifest; ` +
        'the book stays read-only and the manifest file was not modified. ' +
        `Reason: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'ManifestError';
    this.manifestPath = manifestPath;
  }
}

/** The chapter id is not in the book manifest; nothing is read or deleted. */
export class UnknownChapterError extends Error {
  readonly chapterId: string;

  constructor(chapterId: string) {
    super(`Chapter is not in the book manifest: ${chapterId}`);
    this.name = 'UnknownChapterError';
    this.chapterId = chapterId;
  }
}

/** The on-disk pair does not match the expected revision anymore. */
export class WriteConflictError extends Error {
  readonly expected: Revision;
  readonly actual: Revision;

  constructor(expected: Revision, actual: Revision) {
    super('The chapter changed on disk since it was read; reload the pair before saving');
    this.name = 'WriteConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** Sidecar path of a chapter: `<chapter>.review.json` next to the source. */
function reviewPathFor(chapterPath: string): string {
  assertDirectChildName(chapterPath);
  if (!chapterPath.endsWith('.md')) {
    throw new UnsafePathError(`Chapter paths must be Markdown files: ${JSON.stringify(chapterPath)}`);
  }
  return `${chapterPath.slice(0, -'.md'.length)}.review.json`;
}

async function resolveChapter(book: BookHandle, chapterId: string): Promise<{ chapter: Chapter; sourceRel: string; reviewRel: string }> {
  const chapter = book.manifest.chapters.find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) throw new UnknownChapterError(chapterId);
  const candidates = [reviewPathFor(chapter.path), `${chapter.path}.review.json`];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await readOptionalFileBytes(path.join(book.root, candidate)) !== null) existing.push(candidate);
  }
  if (existing.length > 1) throw new Error(`Conflicting review filenames for ${chapter.path}; preserve both files and resolve the duplicate explicitly`);
  const reviewRel = existing[0] ?? candidates[0]!;
  assertReviewIdentity(book, chapter.path, reviewRel);
  return { chapter, sourceRel: chapter.path, reviewRel };
}

function assertReviewIdentity(book: BookHandle, sourceRel: string, reviewRel: string): void {
  assertDirectChildName(reviewRel);
  const matches = book.manifest.chapters.filter(chapter =>
    reviewPathFor(chapter.path) === reviewRel || `${chapter.path}.review.json` === reviewRel);
  if (matches.length !== 1 || matches[0]!.path !== sourceRel) {
    throw new UnsafePathError(`Review filename has no unique source in the manifest: ${reviewRel}`);
  }
}

/**
 * Open the book folder. The root is resolved to its real path; the manifest
 * is read when present (a decode failure is a read-only {@link ManifestError})
 * and otherwise created only when no existing review sidecars need their original
 * identity, from discovery of direct-child ordinary Markdown
 * files with fresh UUIDs, then persisted so re-opening keeps identity and
 * chapter order stable. Existing sidecars are never touched at open time.
 */
export async function openBook(root: string): Promise<BookHandle> {
  const realRoot = await realpath(root);
  const names = await listOrdinaryFiles(realRoot);
  const manifestAbs = path.join(realRoot, MANIFEST_NAME);
  const stored = await readOptionalFileBytes(manifestAbs);
  if (stored !== null) {
    let manifest: Manifest;
    try {
      manifest = decodeManifest(utf8Text(stored));
    } catch (cause) {
      throw new ManifestError(manifestAbs, cause);
    }
    const book = { id: manifest.book_id, root: realRoot, manifest };
    manifestBytes.set(book, stored);
    return book;
  }
  if (names.some((name) => name.endsWith('.review.json'))) {
    throw new ManifestError(manifestAbs, new Error('Existing reviews require the original manifest'));
  }
  const markdownNames = names.filter((name) => name.endsWith('.md') && !name.startsWith('.'));
  const files = [];
  for (const name of markdownNames) {
    files.push({ path: name, bytes: await readFileBytes(path.join(realRoot, name)) });
  }
  const manifest: Manifest = {
    schema_version: 1,
    book_id: randomUUID(),
    title: path.basename(realRoot),
    chapters: discover(files).map((proposal) => ({ id: randomUUID(), path: proposal.path, title: proposal.title })),
    ignored_files: [],
  };
  await replaceManifest(realRoot, manifest);
  const book = { id: manifest.book_id, root: realRoot, manifest };
  manifestBytes.set(book, utf8Bytes(encodeManifest(manifest)));
  return book;
}

async function replaceManifest(realRoot: string, manifest: Manifest): Promise<void> {
  await replaceFileSynced(realRoot, MANIFEST_NAME, utf8Bytes(encodeManifest(manifest)));
}

type RawPair = {
  source: Uint8Array;
  review: Uint8Array | null;
  sourceHash: string;
  reviewHash: string | null;
};

async function readRawPair(book: BookHandle, chapterId: string): Promise<RawPair> {
  const { sourceRel, reviewRel } = await resolveChapter(book, chapterId);
  const sourceAbs = path.join(book.root, sourceRel);
  let source: Uint8Array;
  try {
    source = await readFileBytes(sourceAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Chapter source file is missing: ${sourceAbs}`);
    }
    throw error;
  }
  const review = await readOptionalFileBytes(path.join(book.root, reviewRel));
  return {
    source,
    review,
    sourceHash: sha256Hex(source),
    reviewHash: review === null ? null : sha256Hex(review),
  };
}

/** Read the exact pair of a chapter and its content hashes. */
export async function readPair(book: BookHandle, chapterId: string): Promise<{ pair: Pair; revision: Revision }> {
  const raw = await readRawPair(book, chapterId);
  return {
    pair: {
      source: raw.source,
      review: raw.review === null ? null : utf8Text(raw.review),
    },
    revision: { sourceHash: raw.sourceHash, reviewHash: raw.reviewHash },
  };
}

const chapterQueues = new Map<string, SaveQueue>();

/**
 * All writes to a chapter run under one queue, so journal + rename sequences
 * of a chapter never interleave with each other.
 */
function queueFor(book: BookHandle, chapterId: string): SaveQueue {
  const key = `${book.root}\n${chapterId}`;
  let queue = chapterQueues.get(key);
  if (queue === undefined) {
    queue = new SaveQueue();
    chapterQueues.set(key, queue);
  }
  return queue;
}

/**
 * Replace a chapter pair under an optimistic concurrency check: the pair is
 * re-read, must still match `expected`, then the journaled write sequence
 * runs (journal + fsync → temp files in the book folder → source rename →
 * sidecar rename or confirmed deletion → journal complete → journal removed).
 * Resolves with the revision of the written pair; rejects with
 * {@link WriteConflictError} (nothing written) or an fs/durability error
 * (never reported as success — recovery covers it via the journal).
 */
export function writePair(
  book: BookHandle,
  chapterId: string,
  expected: Revision,
  target: Pair,
  appData: string,
): Promise<Revision> {
  return queueFor(book, chapterId).enqueue(() => writePairImpl(book, chapterId, expected, target, appData));
}

export type WriteStep = 'prepared' | 'source-written' | 'review-written';

/**
 * Internal write implementation with the fault-injection seam. Not part of
 * the public API: tests crash the operation after a step by throwing from
 * `afterStep` and then drive recovery over a fresh {@link openBook}.
 */
export async function writePairImpl(
  book: BookHandle,
  chapterId: string,
  expected: Revision,
  target: Pair,
  appData: string,
  afterStep?: (step: WriteStep) => void,
): Promise<Revision> {
  if ((await readJournalsForRoot(appData, book.root)).some(record => record.chapter_id === chapterId && !record.complete)) {
    throw new Error('Unresolved chapter recovery');
  }
  const { sourceRel, reviewRel } = await resolveChapter(book, chapterId);
  const sourceAbs = path.join(book.root, sourceRel);
  const reviewAbs = path.join(book.root, reviewRel);
  await assertWritableFileTarget(sourceAbs);
  if (target.review !== null) await assertWritableFileTarget(reviewAbs);

  const current = await readRawPair(book, chapterId);
  const actual: Revision = { sourceHash: current.sourceHash, reviewHash: current.reviewHash };
  if (actual.sourceHash !== expected.sourceHash || actual.reviewHash !== expected.reviewHash) {
    throw new WriteConflictError(expected, actual);
  }

  const after: JournalSide = {
    source: encodeBytes(target.source),
    review: target.review === null ? null : encodeBytes(utf8Bytes(target.review)),
  };
  const record: JournalRecord = {
    version: 1,
    root: book.root,
    chapter_id: chapterId,
    source_path: sourceRel,
    review_path: reviewRel,
    complete: false,
    before: {
      source: encodeBytes(current.source),
      review: current.review === null ? null : encodeBytes(current.review),
    },
    after,
  };
  await writeJournal(appData, record);
  afterStep?.('prepared');

  const tmpSource = await writeTempSibling(book.root, sourceRel, target.source);
  const tmpReview = target.review === null ? null : await writeTempSibling(book.root, reviewRel, utf8Bytes(target.review));
  try {
    await renameFileSynced(book.root, tmpSource, sourceAbs);
    afterStep?.('source-written');
    if (tmpReview !== null) {
      await renameFileSynced(book.root, tmpReview, reviewAbs);
    } else if (current.reviewHash !== null) {
      // The re-read confirmed this exact sidecar, so deleting it is safe.
      await unlinkIfPresent(reviewAbs);
      await fsyncDir(book.root);
    }
  } catch (error) {
    await unlinkIfPresent(tmpSource);
    if (tmpReview !== null) await unlinkIfPresent(tmpReview);
    throw error;
  }
  afterStep?.('review-written');

  await markJournalComplete(appData, record);
  await removeJournal(appData, record.root, record.chapter_id);
  return {
    sourceHash: after.source.sha256,
    reviewHash: after.review === null ? null : after.review.sha256,
  };
}

type RecoveryPlan = { writeSource: boolean; writeReview: boolean; deleteReview: boolean };

type FileState = 'before' | 'after' | 'external';

async function fileState(absPath: string, beforeHash: string | null, afterHash: string | null): Promise<FileState> {
  const bytes = await readOptionalFileBytes(absPath);
  const hash = bytes === null ? null : sha256Hex(bytes);
  if (hash === beforeHash) return 'before';
  if (hash === afterHash) return 'after';
  return 'external';
}

/**
 * Compare each file of the journaled operation with its before/after state.
 * Returns the steps still to apply, or `null` when any file is at a third
 * version: recovery must then overwrite nothing.
 */
async function planRecovery(book: BookHandle, record: JournalRecord): Promise<RecoveryPlan | null> {
  assertReviewIdentity(book, record.source_path, record.review_path);
  // The journal pins the original name, even when its sidecar was deleted.
  const alternatives = [reviewPathFor(record.source_path), `${record.source_path}.review.json`];
  for (const alternative of alternatives) {
    if (alternative !== record.review_path && await readOptionalFileBytes(path.join(book.root, alternative)) !== null) return null;
  }
  const sourceState = await fileState(
    path.join(book.root, record.source_path),
    record.before.source.sha256,
    record.after.source.sha256,
  );
  const reviewState = await fileState(
    path.join(book.root, record.review_path),
    record.before.review === null ? null : record.before.review.sha256,
    record.after.review === null ? null : record.after.review.sha256,
  );
  if (sourceState === 'external' || reviewState === 'external') return null;
  return {
    writeSource: sourceState === 'before',
    writeReview: reviewState === 'before' && record.after.review !== null,
    deleteReview: reviewState === 'before' && record.after.review === null,
  };
}

async function applyRecovery(book: BookHandle, record: JournalRecord, plan: RecoveryPlan): Promise<void> {
  if (plan.writeSource) {
    const sourceAbs = path.join(book.root, record.source_path);
    await assertWritableFileTarget(sourceAbs);
    const tmp = await writeTempSibling(book.root, record.source_path, decodeBytes(record.after.source));
    await renameFileSynced(book.root, tmp, sourceAbs);
  }
  if (plan.writeReview) {
    const afterReview = record.after.review;
    if (afterReview === null) throw new Error('Recovery plan wants a review write but the journal has none');
    const reviewAbs = path.join(book.root, record.review_path);
    await assertWritableFileTarget(reviewAbs);
    const tmp = await writeTempSibling(book.root, record.review_path, decodeBytes(afterReview));
    await renameFileSynced(book.root, tmp, reviewAbs);
  } else if (plan.deleteReview) {
    await unlinkIfPresent(path.join(book.root, record.review_path));
    await fsyncDir(book.root);
  }
}

/**
 * Resolve interrupted writes for this book. For every pending journal the
 * current files are compared with the journal's before/after versions: both
 * before completes the prepared operation, a mixed state finishes the
 * missing target, both after just clears the journal; any third version
 * returns 'external-change' and overwrites nothing (the journal is kept).
 * A completed journal is simply removed.
 *
 * Returns 'recovered' when a pending operation was resolved, 'clean' when
 * nothing was pending (or only completed journals remained).
 */
export async function recoverBook(
  book: BookHandle,
  appData: string,
): Promise<'clean' | 'recovered' | 'external-change'> {
  const records = await readJournalsForRoot(appData, book.root);
  if (records.length === 0) return 'clean';
  const plans: Array<{ record: JournalRecord; apply: RecoveryPlan | null }> = [];
  for (const record of records) {
    if (record.complete) {
      plans.push({ record, apply: null });
      continue;
    }
    const apply = await planRecovery(book, record);
    if (apply === null) return 'external-change';
    plans.push({ record, apply });
  }
  for (const { record, apply } of plans) {
    if (apply !== null) await applyRecovery(book, record, apply);
    await removeJournal(appData, record.root, record.chapter_id);
  }
  return records.some((record) => !record.complete) ? 'recovered' : 'clean';
}


/** Preserve a recovery target in a fresh directory; never overwrite user files. */
export async function preserveRecovery(record: JournalRecord, parent: string, book: BookHandle): Promise<string> {
  assertDirectChildName(record.source_path);
  assertReviewIdentity(book, record.source_path, record.review_path);
  const chapter = book.manifest.chapters.find(candidate => candidate.id === record.chapter_id);
  if (chapter === undefined) throw new UnknownChapterError(record.chapter_id);
  if (record.root !== book.root || chapter.path !== record.source_path) throw new Error('Recovery journal changed');
  const directory = await mkdtemp(path.join(parent, 'galley-recovery-'));
  await replaceFileSynced(directory, record.source_path, decodeBytes(record.after.source));
  if (record.after.review !== null) await replaceFileSynced(directory, record.review_path, decodeBytes(record.after.review));
  await replaceFileSynced(directory, 'recovery-journal.json', utf8Bytes(JSON.stringify(record)));
  await replaceManifest(directory, { schema_version: 1, book_id: book.id, title: book.manifest.title, chapters: [chapter], ignored_files: [] });
  await fsyncDir(parent);
  return directory;
}

/** Explicit acceptance only: back up before retiring the pending operation. */
export function acceptRecoveryExternal(book: BookHandle, chapterId: string, appData: string, expected: JournalRecord): Promise<void> {
  return queueFor(book, chapterId).enqueue(async () => {
    const record = (await readJournalsForRoot(appData, book.root)).find(record => record.chapter_id === chapterId && !record.complete);
    if (record === undefined || !isDeepStrictEqual(record, expected)) throw new Error('Recovery journal changed');
    const backups = path.join(appData, 'recovery-backups');
    await mkdir(backups, { recursive: true });
    await preserveRecovery(record, backups, book);
    await fsyncDir(appData);
    const current = (await readJournalsForRoot(appData, book.root)).find(record => record.chapter_id === chapterId && !record.complete);
    if (!isDeepStrictEqual(current, expected)) throw new Error('Recovery journal changed');
    await removeJournal(appData, book.root, chapterId);
    await fsyncDir(appData);
  });
}

/** Explicit author actions; file paths always remain direct children. */
export type BookChange =
  | { type: 'rename'; title: string }
  | { type: 'create'; path: string; title: string }
  | { type: 'add'; paths: string[] }
  | { type: 'remove' | 'trash'; chapterId: string };

/** filesMoved distinguishes partial trash from a refusal that changed no files. */
export class BookManagementError extends Error {
  constructor(message: string, readonly filesMoved = false) { super(message); this.name = 'BookManagementError'; }
}

async function checkedManifest(book: BookHandle): Promise<Uint8Array> {
  const target = path.join(book.root, MANIFEST_NAME);
  await assertWritableFileTarget(target);
  const current = await readOptionalFileBytes(target);
  const expected = manifestBytes.get(book);
  if (!current || !expected || sha256Hex(current) !== sha256Hex(expected)) {
    throw new BookManagementError('Манифест (manifest) изменился на диске. Закройте и снова откройте книгу перед изменением оглавления.');
  }
  return current;
}

/** Scan only ordinary unlisted Markdown files in this book, never add implicitly. */
export async function discoverChapters(book: BookHandle): Promise<Array<{ path: string }>> {
  await checkedManifest(book);
  return (await listOrdinaryFiles(book.root))
    .filter(name => name.endsWith('.md') && !name.startsWith('.') &&
      !book.manifest.ignored_files.includes(name) && !book.manifest.chapters.some(chapter => chapter.path === name))
    .map(path => ({ path }));
}

async function addition(book: BookHandle, name: string, expectedReviews: Map<string, Uint8Array | null>): Promise<Chapter> {
  reviewPathFor(name);
  if (name.startsWith('.') || book.manifest.ignored_files.includes(name) || book.manifest.chapters.some(chapter => chapter.path === name)) {
    throw new BookManagementError('Файл уже в книге, скрыт или исключён из книги.');
  }
  await assertWritableFileTarget(path.join(book.root, name));
  const source = await readFileBytes(path.join(book.root, name));
  let id: string = randomUUID();
  let found = false;
  for (const reviewName of [reviewPathFor(name), `${name}.review.json`]) {
    await assertWritableFileTarget(path.join(book.root, reviewName));
    const bytes = await readOptionalFileBytes(path.join(book.root, reviewName));
    expectedReviews.set(reviewName, bytes);
    if (bytes === null) continue;
    if (found) throw new BookManagementError('Два файла рецензии у одной главы. Разрешите конфликт имён перед добавлением.');
    found = true;
    try {
      const text = utf8Text(bytes);
      const candidate = JSON.parse(text) as { chapter_id: string };
      id = decodeReview(text, candidate.chapter_id, name).chapter_id;
    } catch { throw new BookManagementError('Не удалось проверить принадлежность файла рецензии; файлы не изменены.'); }
  }
  return { id, path: name, title: discover([{ path: name, bytes: source }])[0]?.title ?? name };
}

/** Serializes spine changes and keeps compatible unknown wire fields and version. */
export function manageBook(book: BookHandle, change: BookChange, trashItem?: (absolutePath: string) => Promise<void>): Promise<void> {
  let queue = managementQueues.get(book.root);
  if (!queue) { queue = new SaveQueue(); managementQueues.set(book.root, queue); }
  return queue.enqueue(async () => {
    let filesMoved = false;
    try {
      const bytes = await checkedManifest(book);
      const wire = JSON.parse(utf8Text(bytes)) as { schema_version: number; title: string; chapters?: Array<Record<string, unknown>> };
      const chapters = [...(wire.chapters ?? [])];
      if (change.type === 'rename' || change.type === 'create') {
        if (!change.title.trim() || change.title.includes('\n') || change.title.includes('\r')) throw new BookManagementError('Введите непустое название в одну строку.');
      }
      let created: { name: string; bytes: Uint8Array } | undefined;
      const expectedReviews = new Map<string, Uint8Array | null>();
      if (change.type === 'rename') wire.title = change.title.trim();
      else if (change.type === 'create' || change.type === 'add') {
        const names = change.type === 'create' ? [change.path] : change.paths;
        if (!names.length || new Set(names).size !== names.length) throw new BookManagementError('Выберите разные файлы глав.');
        for (const name of names) {
          if (change.type === 'create') {
            reviewPathFor(name);
            if (name.startsWith('.') || book.manifest.ignored_files.includes(name) || book.manifest.chapters.some(c => c.path === name)) throw new BookManagementError('Это имя уже используется или исключено.');
            for (const target of [name, reviewPathFor(name), `${name}.review.json`]) {
              await assertWritableFileTarget(path.join(book.root, target));
              if (await readOptionalFileBytes(path.join(book.root, target)) !== null) throw new BookManagementError('Файл с этим именем уже существует.');
            }
            for (const reviewName of [reviewPathFor(name), `${name}.review.json`]) expectedReviews.set(reviewName, null);
            created = { name, bytes: utf8Bytes(`# ${change.title.trim()}\n`) };
          }
          const chapter = change.type === 'create' ? { id: randomUUID(), path: name, title: change.title.trim() } : await addition(book, name, expectedReviews);
          if (chapters.some(c => c.id === chapter.id)) throw new BookManagementError('Идентификатор рецензии уже принадлежит другой главе.');
          const reviewNames = [reviewPathFor(chapter.path), `${chapter.path}.review.json`];
          if (chapters.some(c => reviewNames.some(name => name === reviewPathFor(c.path as string) || name === `${c.path}.review.json`))) throw new BookManagementError('Имена файлов рецензии пересекаются с другой главой.');
          chapters.push(wire.schema_version === 2 ? { id: chapter.id, path: chapter.path } : chapter);
        }
        wire.chapters = chapters;
      } else {
        const chapter = book.manifest.chapters.find(c => c.id === change.chapterId);
        if (!chapter) throw new UnknownChapterError(change.chapterId);
        if (change.type === 'trash') {
          if (!trashItem) throw new BookManagementError('Корзина недоступна; файлы не удалены.');
          for (const name of [chapter.path, reviewPathFor(chapter.path), `${chapter.path}.review.json`]) await assertWritableFileTarget(path.join(book.root, name));
          const { sourceRel, reviewRel } = await resolveChapter(book, chapter.id);
          const targets: string[] = [];
          // Validate both targets before moving either one, including symlink guards.
          for (const name of [sourceRel, reviewRel]) {
            await assertWritableFileTarget(path.join(book.root, name));
            if (await readOptionalFileBytes(path.join(book.root, name)) !== null) targets.push(name);
          }
          const review = await readOptionalFileBytes(path.join(book.root, reviewRel));
          if (review) {
            try { decodeReview(utf8Text(review), chapter.id, chapter.path); }
            catch { throw new BookManagementError('Принадлежность рецензии не подтверждена; удаление отменено.'); }
          }
          await checkedManifest(book);
          const moved: string[] = [];
          for (const name of targets) {
            try { await trashItem(path.join(book.root, name)); moved.push(name); filesMoved = true; }
            catch { throw new BookManagementError(`Не удалось переместить файлы в корзину. Перемещены: ${moved.join(', ') || 'нет'}. Остались: ${targets.filter(n => !moved.includes(n)).join(', ')}. Глава оставлена в оглавлении. Обновите список; перемещённые файлы можно восстановить из корзины.`); }
          }
        }
        wire.chapters = chapters.filter(c => c.id !== change.chapterId);
      }
      const next = utf8Bytes(JSON.stringify(wire, null, 2) + '\n');
      const manifest = decodeManifest(utf8Text(next));
      await checkedManifest(book);
      // Exclusive creation never replaces an existing file. If manifest saving fails,
      // leave this new chapter discoverable so it can be explicitly added later.
      if (created) { await writeFileSynced(path.join(book.root, created.name), created.bytes, 'wx'); await fsyncDir(book.root); }
      await checkedManifest(book);
      // Optimistic detection of external changes during preparation, including a
      // previously absent sidecar. External programs can still race after this
      // check; ordinary filesystem renames cannot atomically commit this set.
      for (const [name, expected] of expectedReviews) {
        const target = path.join(book.root, name);
        await assertWritableFileTarget(target);
        if (!isDeepStrictEqual(await readOptionalFileBytes(target), expected)) {
          throw new BookManagementError('Файл рецензии изменился во время добавления главы. Оглавление не изменено; обновите список и повторите добавление.');
        }
      }
      await replaceFileSynced(book.root, MANIFEST_NAME, next);
      book.manifest = manifest;
      manifestBytes.set(book, next);
    } catch (error) {
      if (filesMoved) {
        throw new BookManagementError(error instanceof BookManagementError ? error.message :
          'Файлы главы перемещены в корзину, но оглавление не сохранено. Обновите список; файлы можно восстановить из корзины.', true);
      }
      throw error;
    }
  });
}
