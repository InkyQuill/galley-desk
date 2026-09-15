import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { decodeReview, encodeReview } from '@galley-desk/pocket-format';
import type { Review } from '@galley-desk/pocket-format';
import { applyEdit, changeText, InputHistory, openChapter } from '@galley-desk/review-engine';
import type { ChapterModel, TextChange } from '@galley-desk/review-engine';
import { UnknownChapterError, readPair, writePair } from './book';
import type { BookHandle, Pair, Revision } from './book';
import {
  assertDirectChildName,
  assertWritableFileTarget,
  renameFileSynced,
  utf8Bytes,
  writeFileSynced,
  writeTempSibling,
} from './files';
import { SaveQueue } from './save-queue';
import { ApplyHistory } from './session-history';

export type ChapterSessionState = 'saved' | 'saving' | 'error' | 'external';

export type Draft = { id: string; pair: Pair };

const DRAFT_SUFFIX = '.draft.json';

function emptyReview(chapterId: string, sourcePath: string): Review {
  return {
    schema_version: 1,
    chapter_id: chapterId,
    source_path: sourcePath,
    chapter_note: '',
    edits: [],
    signals: [],
  };
}

function modelFromPair(pair: Pair, chapterId: string, sourcePath: string): ChapterModel {
  const review = pair.review === null ? emptyReview(chapterId, sourcePath) : decodeReview(pair.review, chapterId, sourcePath);
  return openChapter(pair.source, review);
}

/** The canonical pair of a model: its exact source bytes plus the encoded review. */
function pairOf(model: ChapterModel): Pair {
  return { source: model.source, review: encodeReview(model.review) };
}

function draftFileName(chapterId: string): string {
  assertDirectChildName(chapterId);
  return `${chapterId}${DRAFT_SUFFIX}`;
}

type DraftEnvelope = { version: 1; chapter_id: string; source_base64: string; review: string | null };

function toEnvelope(pair: Pair, chapterId: string): string {
  const envelope: DraftEnvelope = {
    version: 1,
    chapter_id: chapterId,
    source_base64: Buffer.from(pair.source).toString('base64'),
    review: pair.review,
  };
  return JSON.stringify(envelope, null, 2);
}

function fromEnvelope(json: string): Draft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const envelope = parsed as Record<keyof DraftEnvelope, unknown>;
  if (
    envelope.version !== 1 ||
    typeof envelope.chapter_id !== 'string' ||
    typeof envelope.source_base64 !== 'string' ||
    (envelope.review !== null && typeof envelope.review !== 'string')
  ) {
    return null;
  }
  return {
    id: envelope.chapter_id,
    pair: { source: new Uint8Array(Buffer.from(envelope.source_base64, 'base64')), review: envelope.review },
  };
}

async function writeDraft(appData: string, chapterId: string, pair: Pair): Promise<void> {
  const name = draftFileName(chapterId);
  await mkdir(appData, { recursive: true });
  const tmp = await writeTempSibling(appData, name, utf8Bytes(toEnvelope(pair, chapterId)));
  await renameFileSynced(appData, tmp, path.join(appData, name));
}

/**
 * Lists the chapter drafts that {@linkcode ChapterSession.checkExternal}
 * preserved in the appData directory. Unreadable or malformed files are
 * skipped; the returned pairs are byte-exact copies of the saved drafts.
 */
export async function readDrafts(appData: string): Promise<Draft[]> {
  let entries;
  try {
    entries = await readdir(appData, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const drafts: Draft[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(DRAFT_SUFFIX)) continue;
    const draft = fromEnvelope(await readFile(path.join(appData, entry.name), 'utf8'));
    if (draft !== null) drafts.push(draft);
  }
  return drafts.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * Writes the review sidecar of a chapter draft to a destination chosen by the
 * user. An occupied destination file is never overwritten — the write uses an
 * exclusive create, so an existing file makes the export fail.
 */
export async function exportDraft(appData: string, id: string, destination: string): Promise<void> {
  const draft = (await readDrafts(appData)).find((candidate) => candidate.id === id);
  if (draft === undefined) throw new Error(`No draft exists for chapter: ${id}`);
  if (draft.pair.review === null) throw new Error(`The draft of chapter ${id} has no review sidecar to export`);
  await assertWritableFileTarget(destination);
  try {
    await writeFileSynced(destination, utf8Bytes(draft.pair.review), 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Refusing to overwrite an existing file: ${destination}`);
    }
    throw error;
  }
}

/**
 * One chapter under editing: a {@linkcode ChapterModel} plus the persisted
 * pair it was read from. Every mutation runs as one queued job that writes
 * the whole target pair through `writePair` and only then updates the model,
 * the revision and the histories — a failed write advances nothing and leaves
 * the session in the `error` state with the target kept as the pending draft.
 *
 * Histories are session-only: input operations (edit, replaceReview,
 * undoInput, redoInput) share the input history of model snapshots and clear
 * the apply stack; applying a correction (apply, undoApply, redoApply) works
 * on whole pairs through {@linkcode ApplyHistory} and clears the input
 * history. `edit` and `replaceReview` take an optional group key: a call
 * without one is its own undo step, while calls sharing the caller's group
 * key merge into one undo step (a typing burst or IME composition). Applying
 * a correction (`apply`), `checkExternal` and `close` invalidate both stacks;
 * `close` clears them after a successful drain and rethrows a persisted save
 * error instead of dropping the model silently.
 */
export class ChapterSession {
  model: ChapterModel;
  revision: Revision;
  state: ChapterSessionState = 'saved';

  private readonly queue = new SaveQueue();
  private readonly inputHistory = new InputHistory();
  private readonly applyHistory = new ApplyHistory();
  private pair: Pair;
  private pending: Pair | null = null;
  private failure: { error: unknown } | null = null;

  /** Истина движка для снапшотов: есть ли шаг undo во вводной истории. */
  get canUndoInput(): boolean {
    return this.inputHistory.canUndo;
  }

  /** Есть ли шаг redo во вводной истории. */
  get canRedoInput(): boolean {
    return this.inputHistory.canRedo;
  }

  /** Есть ли применённая правка, которую можно отменить. */
  get canUndoApply(): boolean {
    return this.applyHistory.canUndo;
  }

  /** Есть ли отменённое применение, которое можно вернуть. */
  get canRedoApply(): boolean {
    return this.applyHistory.canRedo;
  }

  private constructor(
    private readonly book: BookHandle,
    private readonly chapterId: string,
    private readonly sourcePath: string,
    private readonly appData: string,
    pair: Pair,
    revision: Revision,
    model: ChapterModel,
  ) {
    this.pair = pair;
    this.revision = revision;
    this.model = model;
  }

  /** Reads the chapter pair and opens the model over its exact bytes. */
  static async open(book: BookHandle, chapterId: string, appData: string): Promise<ChapterSession> {
    assertDirectChildName(chapterId);
    const chapter = book.manifest.chapters.find((candidate) => candidate.id === chapterId);
    if (chapter === undefined) throw new UnknownChapterError(chapterId);
    const { pair, revision } = await readPair(book, chapterId);
    return new ChapterSession(
      book,
      chapterId,
      chapter.path,
      appData,
      pair,
      revision,
      modelFromPair(pair, chapterId, chapter.path),
    );
  }

  /**
   * Applies derived-text changes as one queued save of the whole pair.
   * Without `group` the call is its own undo step; pass the same `group` key
   * as on the previous call to merge both into one undo step.
   */
  edit(
    changes: TextChange[],
    selection: { anchor: number; head: number },
    group?: string,
  ): Promise<void> {
    const inputGroup = group ?? randomUUID();
    return this.queue.enqueue(async () => {
      const nextModel = changeText(this.model, changes, selection, randomUUID);
      const target = pairOf(nextModel);
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.applyHistory.clear();
        this.inputHistory.push(this.model, nextModel, inputGroup);
        this.adopt(target, nextModel, revision);
        this.state = 'saved';
      } catch (error) {
        this.fail(error, target);
        throw error;
      }
    });
  }

  /**
   * Replaces the whole review sidecar as one queued save. The `group` key
   * follows the same undo-step contract as in {@linkcode edit}.
   */
  replaceReview(review: Review, group?: string): Promise<void> {
    const inputGroup = group ?? randomUUID();
    return this.queue.enqueue(async () => {
      const nextModel = openChapter(this.model.source, review);
      const target = pairOf(nextModel);
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.applyHistory.clear();
        this.inputHistory.push(this.model, nextModel, inputGroup);
        this.adopt(target, nextModel, revision);
        this.state = 'saved';
      } catch (error) {
        this.fail(error, target);
        throw error;
      }
    });
  }

  /**
   * Applies one active correction: the model converges with the corrected
   * source bytes, the applied record is removed from the review and the whole
   * before/after pair transition is remembered for undo once the write and
   * all history updates succeeded.
   */
  apply(id: string): Promise<void> {
    return this.queue.enqueue(async () => {
      const nextModel = applyEdit(this.model, id);
      const target = pairOf(nextModel);
      const before = this.pair;
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.applyHistory.push(before, target);
        this.inputHistory.clear();
        this.adopt(target, nextModel, revision);
        this.state = 'saved';
      } catch (error) {
        this.fail(error, target);
        throw error;
      }
    });
  }

  /** Restores the pair from before the last applied correction. */
  undoApply(): Promise<void> {
    return this.queue.enqueue(async () => {
      const target = this.applyHistory.undoTarget();
      if (target === undefined) return;
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.applyHistory.didUndo();
        this.inputHistory.clear();
        this.adopt(target, modelFromPair(target, this.chapterId, this.sourcePath), revision);
        this.state = 'saved';
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }

  /** Re-applies the last correction undone by {@linkcode undoApply}. */
  redoApply(): Promise<void> {
    return this.queue.enqueue(async () => {
      const target = this.applyHistory.redoTarget();
      if (target === undefined) return;
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.applyHistory.didRedo();
        this.inputHistory.clear();
        this.adopt(target, modelFromPair(target, this.chapterId, this.sourcePath), revision);
        this.state = 'saved';
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }

  /** Restores the previous input snapshot and persists it like a normal edit. */
  undoInput(): Promise<void> {
    return this.queue.enqueue(async () => {
      const restored = this.inputHistory.undo(this.model);
      if (restored === this.model) return;
      const target = pairOf(restored);
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.adopt(target, restored, revision);
        this.state = 'saved';
      } catch (error) {
        // The write failed: put the popped snapshot back so no history moved.
        this.inputHistory.redo(restored);
        this.fail(error);
        throw error;
      }
    });
  }

  /** Re-applies the input snapshot undone by {@linkcode undoInput}. */
  redoInput(): Promise<void> {
    return this.queue.enqueue(async () => {
      const restored = this.inputHistory.redo(this.model);
      if (restored === this.model) return;
      const target = pairOf(restored);
      this.state = 'saving';
      try {
        const revision = await writePair(this.book, this.chapterId, this.revision, target, this.appData);
        this.adopt(target, restored, revision);
        this.state = 'saved';
      } catch (error) {
        this.inputHistory.undo(restored);
        this.fail(error);
        throw error;
      }
    });
  }

  /**
   * Reconciles the session with the book folder. When the freshly read pair
   * still matches the current revision the call is a cheap no-op: the model
   * is not rebuilt and both histories stay untouched. Without local pending
   * work the changed on-disk pair is adopted as-is and both histories are
   * invalidated; with failed or already superseded local work the pending
   * draft pair is first saved atomically into appData and only then the
   * state switches to `external`. A failed draft write changes nothing: the
   * model, the pending work and the state stay as they were.
   */
  checkExternal(): Promise<void> {
    return this.queue.enqueue(async () => {
      if (this.state === 'saved') {
        const { pair, revision } = await readPair(this.book, this.chapterId);
        if (revision.sourceHash === this.revision.sourceHash && revision.reviewHash === this.revision.reviewHash) {
          // Внешней версии нет: дешёвый no-op без перестроения модели.
          return;
        }
        this.applyHistory.clear();
        this.inputHistory.clear();
        this.adopt(pair, modelFromPair(pair, this.chapterId, this.sourcePath), revision);
        this.state = 'saved';
        return;
      }
      await writeDraft(this.appData, this.chapterId, this.pending ?? this.pair);
      this.applyHistory.clear();
      this.inputHistory.clear();
      this.state = 'external';
    });
  }

  /**
   * Finishes the resolution of an external change (user picked
   * «open-external»/«export-local»): the on-disk pair becomes the working
   * base again, both histories start empty and the state returns to `saved`.
   * The preserved draft stays in appData as the user's backup copy.
   */
  adoptExternal(): Promise<void> {
    return this.queue.enqueue(async () => {
      const { pair, revision } = await readPair(this.book, this.chapterId);
      this.applyHistory.clear();
      this.inputHistory.clear();
      this.adopt(pair, modelFromPair(pair, this.chapterId, this.sourcePath), revision);
      this.state = 'saved';
    });
  }

  /**
   * Drains the save queue, then clears both histories. A persisted save error
   * is rethrown — the model is never dropped silently — and the histories
   * stay untouched in that case.
   */
  async close(): Promise<void> {
    await this.queue.drain();
    if (this.state === 'error') {
      throw this.failure === null ? new Error(`The chapter session has a failed save: ${this.chapterId}`) : this.failure.error;
    }
    this.applyHistory.clear();
    this.inputHistory.clear();
  }

  /** Commits a successful write: pair, model, revision and pending draft. */
  private adopt(target: Pair, model: ChapterModel, revision: Revision): void {
    this.pair = target;
    this.model = model;
    this.revision = revision;
    this.pending = null;
    this.failure = null;
  }

  /** Records a failed write; `pending` keeps the local work for the draft. */
  private fail(error: unknown, pending?: Pair): void {
    this.state = 'error';
    this.failure = { error };
    if (pending !== undefined) this.pending = pending;
  }
}
