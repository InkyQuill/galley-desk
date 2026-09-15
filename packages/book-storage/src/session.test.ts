import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { decodeReview, encodeReview, makeAnchor } from '@galley-desk/pocket-format';
import type { Edit, Review } from '@galley-desk/pocket-format';
import { openBook, readPair, WriteConflictError } from './index';
import type { BookHandle } from './index';
import { ChapterSession, exportDraft, readDrafts } from './index';

const BYTES = new TextEncoder().encode('abcd');
// Record ids are UUIDs on the review wire format (review-v1 schema).
const E1_ID = '22222222-2222-4222-8222-222222222222';
const E2_ID = '33333333-3333-4333-8333-333333333333';
const S1_ID = '44444444-4444-4444-8444-444444444444';
const STALE_ID = '55555555-5555-4555-8555-555555555555';
const INSIDE_ID = '66666666-6666-4666-8666-666666666666';
const E1: Edit = { id: E1_ID, before: 'ab', after: 'X', anchor: makeAnchor(BYTES, { from: 0, to: 2 }) };

function reviewFor(chapterId: string, edits: Edit[], chapterNote = ''): Review {
  return {
    schema_version: 1,
    chapter_id: chapterId,
    source_path: '01.md',
    chapter_note: chapterNote,
    signals: [],
    edits,
  };
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeBook(): Promise<{
  book: BookHandle;
  chapterId: string;
  appData: string;
  root: string;
  writeSidecar: (review: Review) => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'galley-session-'));
  roots.push(root);
  await writeFile(path.join(root, '01.md'), 'abcd');
  const book = await openBook(root);
  const chapterId = book.manifest.chapters[0]!.id;
  const appData = path.join(root, 'appdata');
  await mkdir(appData);
  return {
    book,
    chapterId,
    appData,
    root,
    async writeSidecar(review: Review) {
      await writeFile(path.join(root, '01.review.json'), encodeReview(review));
    },
  };
}

/** An external writer that bypasses the session: raw disk change of 01.md. */
async function externalWrite(root: string, text: string): Promise<void> {
  await writeFile(path.join(root, '01.md'), text);
}

test('two consecutive edits without a group are two separate undo steps', async () => {
  const { book, chapterId, appData } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.edit([{ from: 4, to: 4, insert: '!' }], { anchor: 5, head: 5 });
  const first = await readPair(book, chapterId);
  await session.edit([{ from: 5, to: 5, insert: '?' }], { anchor: 6, head: 6 });
  const second = await readPair(book, chapterId);
  expect(session.model.text).toBe('abcd!?');

  await session.undoInput();
  const once = await readPair(book, chapterId);
  expect(session.model.text).toBe('abcd!');
  expect(once.pair.review).toBe(first.pair.review);
  expect(once.pair.source).toEqual(first.pair.source);

  await session.undoInput();
  const twice = await readPair(book, chapterId);
  expect(session.model.text).toBe('abcd');
  expect(twice.pair.source).toEqual(BYTES);
  expect(twice.pair.review).toBe(encodeReview(reviewFor(chapterId, [])));

  await session.redoInput();
  const redone = await readPair(book, chapterId);
  expect(session.model.text).toBe('abcd!');
  expect(redone.pair.review).toBe(first.pair.review);
  expect(redone.pair.review).not.toBe(second.pair.review);
  await session.close();
});

test('edits sharing one explicit group merge into a single undo step', async () => {
  const { book, chapterId, appData } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.edit([{ from: 4, to: 4, insert: '!' }], { anchor: 5, head: 5 }, 'burst-1');
  await session.edit([{ from: 5, to: 5, insert: '?' }], { anchor: 6, head: 6 }, 'burst-1');
  expect(session.model.text).toBe('abcd!?');

  await session.undoInput();
  const undone = await readPair(book, chapterId);
  expect(session.model.text).toBe('abcd');
  expect(undone.pair.review).toBe(encodeReview(reviewFor(chapterId, [])));
  expect(undone.pair.source).toEqual(BYTES);

  await session.redoInput();
  expect(session.model.text).toBe('abcd!?');
  await session.close();
});

test('edits with different explicit groups stay separate undo steps', async () => {
  const { book, chapterId, appData } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.edit([{ from: 4, to: 4, insert: '!' }], { anchor: 5, head: 5 }, 'burst-1');
  const first = await readPair(book, chapterId);
  await session.edit([{ from: 5, to: 5, insert: '?' }], { anchor: 6, head: 6 }, 'burst-2');
  expect(session.model.text).toBe('abcd!?');

  await session.undoInput();
  expect(session.model.text).toBe('abcd!');
  expect((await readPair(book, chapterId)).pair.review).toBe(first.pair.review);

  await session.undoInput();
  expect(session.model.text).toBe('abcd');
  expect((await readPair(book, chapterId)).pair.review).toBe(encodeReview(reviewFor(chapterId, [])));
  await session.close();
});

test('apply, undoApply and redoApply write both pairs byte-for-byte with every anchor and signal', async () => {
  const { book, chapterId, appData, writeSidecar } = await makeBook();
  const original = reviewFor(chapterId, [
    E1,
    { id: E2_ID, before: 'cd', after: 'Y', anchor: makeAnchor(BYTES, { from: 2, to: 4 }) },
  ], 'note');
  original.signals = [
    { id: S1_ID, type: 'review', comment: 'keep', selected_text: 'cd', anchor: makeAnchor(BYTES, { from: 2, to: 4 }) },
  ];
  await writeSidecar(original);
  const session = await ChapterSession.open(book, chapterId, appData);
  const before = await readPair(book, chapterId);

  await session.apply(E1_ID);
  expect(session.state).toBe('saved');
  expect(session.model.text).toBe('XY');
  const applied = await readPair(book, chapterId);
  expect(new TextDecoder().decode(applied.pair.source)).toBe('Xcd');
  expect(applied.pair.review).toBe(encodeReview(session.model.review));
  expect(session.revision).toEqual(applied.revision);
  const appliedReview = decodeReview(applied.pair.review as string, chapterId, '01.md');
  expect(appliedReview.edits.map((edit) => edit.id)).toEqual([E2_ID]);
  expect(appliedReview.edits[0]!.anchor.start_byte).toBe(1);
  expect(appliedReview.signals[0]!.anchor.start_byte).toBe(1);
  expect(appliedReview.chapter_note).toBe('note');
  const appliedSnapshot = structuredClone(appliedReview);

  await session.undoApply();
  const undone = await readPair(book, chapterId);
  expect(undone.pair.review).toBe(before.pair.review);
  expect(undone.pair.source).toEqual(before.pair.source);
  expect(undone.revision).toEqual(before.revision);
  expect(decodeReview(undone.pair.review as string, chapterId, '01.md')).toEqual(original);

  await session.redoApply();
  const redone = await readPair(book, chapterId);
  expect(redone.pair.review).toBe(applied.pair.review);
  expect(redone.pair.source).toEqual(applied.pair.source);
  expect(decodeReview(redone.pair.review as string, chapterId, '01.md')).toEqual(appliedSnapshot);
  expect(structuredClone(session.model.review)).toEqual(appliedSnapshot);
  expect(session.model.text).toBe('XY');

  await session.close();
});

test('an ordinary mutation after apply invalidates the apply history', async () => {
  const { book, chapterId, appData, writeSidecar } = await makeBook();
  await writeSidecar(reviewFor(chapterId, [E1]));
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.apply(E1_ID);
  await session.edit([{ from: 3, to: 3, insert: '!' }], { anchor: 4, head: 4 });
  expect(session.state).toBe('saved');
  expect(session.model.text).toBe('Xcd!');

  await session.undoApply();
  await session.redoApply();
  const pair = await readPair(book, chapterId);
  // The pair's source bytes stay 'Xcd' — the '!' lives in the sidecar record.
  expect(new TextDecoder().decode(pair.pair.source)).toBe('Xcd');
  expect(pair.pair.review).toBe(encodeReview(session.model.review));
  expect(session.model.text).toBe('Xcd!');
  await session.close();
});

test('close clears both histories and a reopened session starts empty', async () => {
  const { book, chapterId, appData, writeSidecar } = await makeBook();
  await writeSidecar(reviewFor(chapterId, [E1]));
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.edit([{ from: 3, to: 3, insert: 'Z' }], { anchor: 4, head: 4 });
  await session.apply(E1_ID);
  expect(session.model.text).toBe('XcdZ');
  await session.close();

  const afterClose = await readPair(book, chapterId);
  await session.undoApply();
  await session.redoApply();
  await session.undoInput();
  await session.redoInput();
  const unchanged = await readPair(book, chapterId);
  expect(unchanged.pair.review).toBe(afterClose.pair.review);
  expect(unchanged.pair.source).toEqual(afterClose.pair.source);

  const reopened = await ChapterSession.open(book, chapterId, appData);
  expect(reopened.model.text).toBe('XcdZ');
  await reopened.undoApply();
  await reopened.undoInput();
  const stillUnchanged = await readPair(book, chapterId);
  expect(stillUnchanged.pair.review).toBe(afterClose.pair.review);
  expect(stillUnchanged.pair.source).toEqual(afterClose.pair.source);
  await reopened.close();
});

test('checkExternal adopts the on-disk pair and invalidates both histories', async () => {
  const { book, chapterId, appData, root, writeSidecar } = await makeBook();
  await writeSidecar(reviewFor(chapterId, [E1]));
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.apply(E1_ID);
  await session.edit([{ from: 3, to: 3, insert: '!' }], { anchor: 4, head: 4 });
  await externalWrite(root, 'ABCD');

  await session.checkExternal();
  expect(session.state).toBe('saved');
  expect(session.model.text).toBe('ABCD');
  const pair = await readPair(book, chapterId);
  expect(session.revision).toEqual(pair.revision);

  await session.undoApply();
  await session.undoInput();
  const unchanged = await readPair(book, chapterId);
  expect(unchanged.pair.source).toEqual(new TextEncoder().encode('ABCD'));
  expect(unchanged.pair.review).toBe(pair.pair.review);
  await session.close();
});

test('a failed note update is kept as a draft and checkExternal switches the session to external', async () => {
  const { book, chapterId, appData, root } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await externalWrite(root, 'abcd!');
  const noted = reviewFor(chapterId, [], 'reviewed');

  await expect(session.replaceReview(noted)).rejects.toThrow(WriteConflictError);
  expect(session.state).toBe('error');
  expect(session.model.review.chapter_note).toBe('');

  await session.checkExternal();
  expect(session.state).toBe('external');
  expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe('abcd!');
  const drafts = await readDrafts(appData);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]!.id).toBe(chapterId);
  expect(drafts[0]!.pair.review).toBe(encodeReview(noted));
  expect(drafts[0]!.pair.source).toEqual(BYTES);
});

test('a failing draft write keeps the model and the error state', async () => {
  const { book, chapterId, appData, root } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await externalWrite(root, 'abcd!');
  await expect(session.replaceReview(reviewFor(chapterId, [], 'reviewed'))).rejects.toThrow(WriteConflictError);
  expect(session.state).toBe('error');
  await mkdir(path.join(appData, `${chapterId}.draft.json`));

  await expect(session.checkExternal()).rejects.toThrow();
  expect(session.state).toBe('error');
  expect(session.model.text).toBe('abcd');
  expect(await readDrafts(appData)).toEqual([]);
});

test('undoInput and redoInput save through the queue and never restore the apply stack', async () => {
  const { book, chapterId, appData, writeSidecar } = await makeBook();
  await writeSidecar(reviewFor(chapterId, [E1]));
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.apply(E1_ID);
  const appliedPair = await readPair(book, chapterId);
  await session.edit([{ from: 3, to: 3, insert: '!' }], { anchor: 4, head: 4 });
  const editedPair = await readPair(book, chapterId);
  // The source bytes stay 'Xcd'; the typed '!' lives in the sidecar record.
  expect(new TextDecoder().decode(editedPair.pair.source)).toBe('Xcd');

  await session.undoInput();
  const undonePair = await readPair(book, chapterId);
  expect(undonePair.pair.review).toBe(appliedPair.pair.review);
  expect(undonePair.pair.source).toEqual(appliedPair.pair.source);

  await session.undoApply();
  const stillPair = await readPair(book, chapterId);
  expect(stillPair.pair.review).toBe(appliedPair.pair.review);
  expect(stillPair.pair.source).toEqual(appliedPair.pair.source);

  await session.redoInput();
  const redonePair = await readPair(book, chapterId);
  expect(redonePair.pair.review).toBe(editedPair.pair.review);
  expect(redonePair.pair.source).toEqual(editedPair.pair.source);
  await session.close();
});

test('readDrafts lists drafts and exportDraft refuses occupied destinations', async () => {
  const { book, chapterId, appData, root } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await externalWrite(root, 'abcd!');
  const noted = reviewFor(chapterId, [], 'reviewed');
  await expect(session.replaceReview(noted)).rejects.toThrow(WriteConflictError);
  await session.checkExternal();

  const destination = path.join(root, 'notes.review.json');
  await exportDraft(appData, chapterId, destination);
  expect(await readFile(destination, 'utf8')).toBe(encodeReview(noted));

  await expect(exportDraft(appData, chapterId, destination)).rejects.toThrow(/overwrite/);
  await expect(exportDraft(appData, '00000000-0000-4000-8000-000000000000', path.join(root, 'other.json')))
    .rejects.toThrow(/No draft/);
  expect(await readFile(destination, 'utf8')).toBe(encodeReview(noted));
});

test('close surfaces a failed save instead of silently dropping the model', async () => {
  const { book, chapterId, appData, root } = await makeBook();
  const session = await ChapterSession.open(book, chapterId, appData);
  await externalWrite(root, 'abcd!');
  await expect(session.replaceReview(reviewFor(chapterId, [], 'reviewed'))).rejects.toThrow(WriteConflictError);

  await expect(session.close()).rejects.toThrow(/changed on disk/);
  expect(session.state).toBe('error');
  expect(session.model.text).toBe('abcd');
});

test('applying through the session removes a signal inside the replacement and keeps a stale record', async () => {
  const { book, chapterId, appData, writeSidecar } = await makeBook();
  const stale = { id: STALE_ID, before: 'zz', after: 'q', anchor: makeAnchor(BYTES, { from: 2, to: 4 }) };
  const inside = {
    id: INSIDE_ID,
    type: 'review' as const,
    comment: '',
    selected_text: 'ab',
    anchor: makeAnchor(BYTES, { from: 0, to: 2 }),
  };
  const sidecar = reviewFor(chapterId, [E1, stale]);
  sidecar.signals = [inside];
  await writeSidecar(sidecar);
  const session = await ChapterSession.open(book, chapterId, appData);
  await session.apply(E1_ID);

  const pair = await readPair(book, chapterId);
  const review = decodeReview(pair.pair.review as string, chapterId, '01.md');
  expect(review.signals).toEqual([]);
  expect(review.edits).toContainEqual(stale);
  expect(session.model.text).toBe('Xcd');
  await session.close();
});
