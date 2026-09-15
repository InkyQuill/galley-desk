import { expect, test } from 'vitest';
import { mkdtemp, readdir, realpath, readFile, rm, symlink, unlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { decodeManifest, encodeManifest, encodeReview } from '@galley-desk/pocket-format';
import type { BookHandle, Pair, Revision } from './book';
import { ManifestError, UnknownChapterError, WriteConflictError, openBook, readPair, recoverBook, writePair, writePairImpl } from './book';
import { sha256Hex, utf8Bytes, UnsafePathError } from './files';
import { readJournalsForRoot } from './journal';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const BOOK_ID = '99999999-9999-4999-8999-999999999999';
const SOURCE_1 = '# Alpha\r\n\r\nпервая строка\r\n';
const NEXT_SOURCE = utf8Bytes('# Alpha v2\r\n\r\nточные UTF-8 байты\r\nсохранены\r\n');

function reviewJson(chapterId: string, sourcePath: string, note = ''): string {
  return encodeReview({
    schema_version: 1,
    chapter_id: chapterId,
    source_path: sourcePath,
    chapter_note: note,
    edits: [],
    signals: [],
  });
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function seedBook(): Promise<string> {
  const root = await tempDir('galley-book-');
  await writeFile(path.join(root, '01.md'), SOURCE_1, 'utf8');
  await writeFile(path.join(root, '02.md'), '# Beta\n', 'utf8');
  await writeFile(path.join(root, '.pocket-editor.json'), encodeManifest({
    schema_version: 1,
    book_id: BOOK_ID,
    title: 'Seeded Book',
    chapters: [
      { id: ID1, path: '01.md', title: 'Alpha' },
      { id: ID2, path: '02.md', title: 'Beta' },
    ],
    ignored_files: [],
  }), 'utf8');
  await writeFile(path.join(root, '01.review.json'), reviewJson(ID1, '01.md'), 'utf8');
  return root;
}

async function cleanup(...dirs: string[]): Promise<void> {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

function revisionOf(source: Uint8Array, review: string | null): Revision {
  return {
    sourceHash: sha256Hex(source),
    reviewHash: review === null ? null : sha256Hex(utf8Bytes(review)),
  };
}

async function bookBytes(root: string, name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(root, name)));
}

async function leftoverTemps(root: string): Promise<string[]> {
  return (await readdir(root)).filter((name) => name.includes('.galley-'));
}

test('opening a book without a manifest creates one; UUID and order are stable across reopen', async () => {
  const root = await tempDir('galley-book-');
  try {
    await writeFile(path.join(root, 'b.md'), '---\nnumber: 1\n---\n\n# Бэта\n', 'utf8');
    await writeFile(path.join(root, 'a.md'), '# Альфа\n', 'utf8');
    await writeFile(path.join(root, 'notes.txt'), 'not a chapter', 'utf8');
    await writeFile(path.join(root, '.hidden.md'), 'ignored', 'utf8');
    const book = await openBook(root);
    expect(book.id).toBe(book.manifest.book_id);
    expect(book.manifest.chapters.map((chapter) => chapter.path)).toEqual(['b.md', 'a.md']);
    const stored = decodeManifest(await readFile(path.join(root, '.pocket-editor.json'), 'utf8'));
    expect(stored).toEqual(book.manifest);
    const reopened = await openBook(root);
    expect(reopened.id).toBe(book.id);
    expect(reopened.manifest).toEqual(book.manifest);
  } finally {
    await cleanup(root);
  }
});

test('opening an existing book reads the manifest and never rewrites it', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const manifestAbs = path.join(root, '.pocket-editor.json');
    const before = await readFile(manifestAbs);
    const book = await openBook(root);
    expect(book.id).toBe(BOOK_ID);
    expect(book.root).toBe(await realpath(root));
    await openBook(root);
    expect(await readFile(manifestAbs)).toEqual(before);
    expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
  } finally {
    await cleanup(root, appData);
  }
});

test('a manifest with an unknown schema version opens as a read-only identity error and is never upgraded', async () => {
  const root = await tempDir('galley-book-');
  try {
    await writeFile(path.join(root, '01.md'), SOURCE_1, 'utf8');
    await writeFile(path.join(root, '01.review.json'), reviewJson(ID1, '01.md'), 'utf8');
    const manifestAbs = path.join(root, '.pocket-editor.json');
    const newer = JSON.stringify({
      schema_version: 3,
      book_id: BOOK_ID,
      title: 'Written by a newer Pocket Editor',
      chapters: [{ id: ID1, path: '01.md' }],
      ignored_files: [],
    });
    await writeFile(manifestAbs, newer, 'utf8');
    const error = await openBook(root).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ManifestError);
    const manifestError = error as ManifestError;
    expect(manifestError.manifestPath).toBe(manifestAbs);
    expect(manifestError.cause).toBeInstanceOf(Error);
    expect(manifestError.message).toMatch(/read-only/);
    expect(await readFile(manifestAbs, 'utf8')).toBe(newer);
    expect(await readFile(path.join(root, '01.review.json'), 'utf8')).toBe(reviewJson(ID1, '01.md'));
  } finally {
    await cleanup(root);
  }
});

/** A synthetic v2 manifest as the pinned Pocket Editor baseline writes it (chapters without titles). */
async function seedV2Book(): Promise<string> {
  const root = await tempDir('galley-book-');
  await writeFile(path.join(root, '01.md'), SOURCE_1, 'utf8');
  await writeFile(path.join(root, '02.md'), '# Beta\n', 'utf8');
  await writeFile(path.join(root, '01.review.json'), reviewJson(ID1, '01.md'), 'utf8');
  await writeFile(path.join(root, '.pocket-editor.json'), JSON.stringify({
    schema_version: 2,
    book_id: BOOK_ID,
    title: 'Written by Pocket Editor',
    chapters: [
      { id: ID2, path: '02.md' },
      { id: ID1, path: '01.md' },
    ],
    ignored_files: [],
  }), 'utf8');
  return root;
}

test('a v2 manifest written by Pocket Editor opens tolerantly with chapters in wire order', async () => {
  const root = await seedV2Book();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    expect(book.id).toBe(BOOK_ID);
    expect(book.manifest.chapters.map((chapter) => [chapter.id, chapter.path, chapter.title])).toEqual([
      [ID2, '02.md', ''],
      [ID1, '01.md', ''],
    ]);
    const pair = await readPair(book, ID1);
    expect(pair.pair.review).toBe(reviewJson(ID1, '01.md'));
    expect(Buffer.from(pair.pair.source).equals(Buffer.from(SOURCE_1, 'utf8'))).toBe(true);
  } finally {
    await cleanup(root, appData);
  }
});

test('opening a book with a v2 manifest never rewrites the manifest or an existing sidecar', async () => {
  const root = await seedV2Book();
  try {
    const manifestAbs = path.join(root, '.pocket-editor.json');
    const sidecarAbs = path.join(root, '01.review.json');
    const manifestBefore = await readFile(manifestAbs, 'utf8');
    const sidecarBefore = await readFile(sidecarAbs, 'utf8');
    const mtimeBefore = (await lstat(manifestAbs)).mtimeMs;

    await openBook(root);
    await openBook(root);

    expect(await readFile(manifestAbs, 'utf8')).toBe(manifestBefore);
    expect((await lstat(manifestAbs)).mtimeMs).toBe(mtimeBefore);
    expect(await readFile(sidecarAbs, 'utf8')).toBe(sidecarBefore);
  } finally {
    await cleanup(root);
  }
});

test('a structurally invalid v2 manifest is a read-only ManifestError and is never rewritten', async () => {
  const root = await seedV2Book();
  try {
    const manifestAbs = path.join(root, '.pocket-editor.json');
    await writeFile(manifestAbs, JSON.stringify({
      schema_version: 2,
      book_id: 'not-a-uuid',
      title: 'Broken',
      chapters: [{ id: ID1, path: '01.md' }],
      ignored_files: [],
    }), 'utf8');
    const before = await readFile(manifestAbs, 'utf8');
    const error = await openBook(root).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ManifestError);
    expect((error as ManifestError).cause).toBeInstanceOf(Error);
    expect(await readFile(manifestAbs, 'utf8')).toBe(before);

    await writeFile(manifestAbs, JSON.stringify({
      schema_version: 2,
      book_id: BOOK_ID,
      title: 'Broken',
      chapters: [
        { id: ID1, path: '01.md' },
        { id: ID1, path: '02.md' },
      ],
      ignored_files: [],
    }), 'utf8');
    const errorDup = await openBook(root).then(() => null, (thrown: unknown) => thrown);
    expect(errorDup).toBeInstanceOf(ManifestError);
    expect((errorDup as ManifestError).message).toMatch(/Chapter IDs must be unique/);
  } finally {
    await cleanup(root);
  }
});

test('a corrupt manifest is a read-only identity error too', async () => {
  const root = await tempDir('galley-book-');
  try {
    const manifestAbs = path.join(root, '.pocket-editor.json');
    await writeFile(manifestAbs, '{ not json', 'utf8');
    const error = await openBook(root).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ManifestError);
    expect(await readFile(manifestAbs, 'utf8')).toBe('{ not json');
  } finally {
    await cleanup(root);
  }
});

test('opening a missing directory fails instead of faking success', async () => {
  await expect(openBook('/galley-definitely-missing-book')).rejects.toThrow();
});

test('readPair returns exact bytes and hashes; a missing sidecar reads as null', async () => {
  const root = await seedBook();
  const book = await openBook(root);
  try {
    const first = await readPair(book, ID1);
    expect(Buffer.from(first.pair.source).equals(Buffer.from(SOURCE_1, 'utf8'))).toBe(true);
    expect(first.pair.review).toBe(reviewJson(ID1, '01.md'));
    expect(first.revision).toEqual(revisionOf(utf8Bytes(SOURCE_1), first.pair.review));
    const second = await readPair(book, ID2);
    expect(second.pair.review).toBeNull();
    expect(second.revision.reviewHash).toBeNull();
  } finally {
    await cleanup(root);
  }
});

test('unknown chapter and missing source errors never delete the review', async () => {
  const root = await seedBook();
  const book = await openBook(root);
  const appData = await tempDir('galley-appdata-');
  try {
    const sidecarBefore = await bookBytes(root, '01.review.json');
    await expect(readPair(book, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(UnknownChapterError);
    const target: Pair = { source: NEXT_SOURCE, review: null };
    await expect(writePair(book, '00000000-0000-4000-8000-000000000000', { sourceHash: 'x', reviewHash: null }, target, appData))
      .rejects.toBeInstanceOf(UnknownChapterError);
    expect(await bookBytes(root, '01.review.json')).toEqual(sidecarBefore);
    await unlink(path.join(root, '01.md'));
    await expect(readPair(book, ID1)).rejects.toThrow(/missing/);
    expect(await bookBytes(root, '01.review.json')).toEqual(sidecarBefore);
  } finally {
    await cleanup(root, appData);
  }
});

test('writePair replaces source then sidecar with exact bytes and returns the new revision', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    const targetReview = reviewJson(ID1, '01.md', 'обновлено');
    const target: Pair = { source: NEXT_SOURCE, review: targetReview };
    const next = await writePair(book, ID1, revision, target, appData);
    expect(next).toEqual(revisionOf(NEXT_SOURCE, targetReview));
    const reread = await readPair(book, ID1);
    expect(reread.revision).toEqual(next);
    expect(Buffer.from(await bookBytes(root, '01.md')).equals(Buffer.from(NEXT_SOURCE))).toBe(true);
    expect(await bookBytes(root, '01.review.json')).toEqual(utf8Bytes(targetReview));
    expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
    expect(await leftoverTemps(root)).toEqual([]);
  } finally {
    await cleanup(root, appData);
  }
});

test('writePair stores sidecar bytes verbatim without decoding them', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID2);
    const opaque = '{"whatever":true,"note":"валидация не забота storage"}';
    await writePair(book, ID2, revision, { source: utf8Bytes('# Beta v2\n'), review: opaque }, appData);
    expect(await readFile(path.join(root, '02.review.json'), 'utf8')).toBe(opaque);
  } finally {
    await cleanup(root, appData);
  }
});

test('a stale expected revision conflicts and writes nothing at all', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    await writeFile(path.join(root, '01.md'), 'внешняя правка источника', 'utf8');
    const target: Pair = { source: NEXT_SOURCE, review: reviewJson(ID1, '01.md', 'обновлено') };
    const error = await writePair(book, ID1, revision, target, appData).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(WriteConflictError);
    const conflict = error as WriteConflictError;
    expect(conflict.expected).toEqual(revision);
    expect(conflict.actual.sourceHash).toBe(sha256Hex(utf8Bytes('внешняя правка источника')));
    expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe('внешняя правка источника');
    expect(await readFile(path.join(root, '01.review.json'), 'utf8')).toBe(reviewJson(ID1, '01.md'));
    expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
    // a stale sidecar hash conflicts as well
    const fresh = await readPair(book, ID1);
    await writeFile(path.join(root, '01.review.json'), reviewJson(ID1, '01.md', 'третья сторона'), 'utf8');
    await expect(writePair(book, ID1, fresh.revision, target, appData)).rejects.toBeInstanceOf(WriteConflictError);
  } finally {
    await cleanup(root, appData);
  }
});

test('target review null deletes only the confirmed sidecar', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    const next = await writePair(book, ID1, revision, { source: NEXT_SOURCE, review: null }, appData);
    expect(next.reviewHash).toBeNull();
    expect(await readdir(root)).not.toContain('01.review.json');
    expect(Buffer.from(await bookBytes(root, '01.md')).equals(Buffer.from(NEXT_SOURCE))).toBe(true);
    expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
  } finally {
    await cleanup(root, appData);
  }
});

test.each(['prepared', 'source-written', 'review-written'] as const)(
  'injected crash at %s: recoverBook lands the exact pair exactly once',
  async (step) => {
    const root = await seedBook();
    const appData = await tempDir('galley-appdata-');
    try {
      const book = await openBook(root);
      const { revision } = await readPair(book, ID1);
      const target: Pair = { source: NEXT_SOURCE, review: reviewJson(ID1, '01.md', 'после аварии') };
      await expect(writePairImpl(book, ID1, revision, target, appData, (s) => {
        if (s === step) throw new Error(`injected crash at ${s}`);
      })).rejects.toThrow(`injected crash at ${step}`);
      const reopened = await openBook(root);
      expect(await recoverBook(reopened, appData)).toBe('recovered');
      const landed = await readPair(reopened, ID1);
      expect(landed.revision).toEqual(revisionOf(target.source, target.review));
      expect(Buffer.from(landed.pair.source).equals(Buffer.from(target.source))).toBe(true);
      expect(landed.pair.review).toBe(target.review);
      expect(await recoverBook(reopened, appData)).toBe('clean');
      const again = await readPair(reopened, ID1);
      expect(Buffer.from(again.pair.source).equals(Buffer.from(target.source))).toBe(true);
      expect(again.pair.review).toBe(target.review);
      expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
      expect(await leftoverTemps(root)).toEqual([]);
    } finally {
      await cleanup(root, appData);
    }
  },
);

test.each(['prepared', 'source-written', 'review-written'] as const)(
  'injected crash at %s: recovery lands a confirmed sidecar deletion exactly once',
  async (step) => {
    const root = await seedBook();
    const appData = await tempDir('galley-appdata-');
    try {
      const book = await openBook(root);
      const { revision } = await readPair(book, ID1);
      const target: Pair = { source: NEXT_SOURCE, review: null };
      await expect(writePairImpl(book, ID1, revision, target, appData, (s) => {
        if (s === step) throw new Error(`injected crash at ${s}`);
      })).rejects.toThrow(`injected crash at ${step}`);
      const reopened = await openBook(root);
      expect(await recoverBook(reopened, appData)).toBe('recovered');
      expect(await readdir(root)).not.toContain('01.review.json');
      expect(Buffer.from(await bookBytes(root, '01.md')).equals(Buffer.from(NEXT_SOURCE))).toBe(true);
      expect(await recoverBook(reopened, appData)).toBe('clean');
      expect(await readdir(root)).not.toContain('01.review.json');
      expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
    } finally {
      await cleanup(root, appData);
    }
  },
);

test('crash during a first sidecar creation: recovery writes the missing target', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID2);
    const target: Pair = { source: utf8Bytes('# Beta v2\n'), review: reviewJson(ID2, '02.md', 'новый sidecar') };
    await expect(writePairImpl(book, ID2, revision, target, appData, (s) => {
      if (s === 'source-written') throw new Error('injected crash');
    })).rejects.toThrow('injected crash');
    const reopened = await openBook(root);
    expect(await recoverBook(reopened, appData)).toBe('recovered');
    expect(await readFile(path.join(root, '02.review.json'), 'utf8')).toBe(target.review);
    expect(await readFile(path.join(root, '02.md'), 'utf8')).toBe('# Beta v2\n');
    expect(await recoverBook(reopened, appData)).toBe('clean');
  } finally {
    await cleanup(root, appData);
  }
});

test('a third external source version stops recovery and overwrites nothing', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    const target: Pair = { source: NEXT_SOURCE, review: reviewJson(ID1, '01.md', 'обновлено') };
    await expect(writePairImpl(book, ID1, revision, target, appData, (s) => {
      if (s === 'prepared') throw new Error('injected crash');
    })).rejects.toThrow('injected crash');
    await writeFile(path.join(root, '01.md'), 'правка третьей стороны', 'utf8');
    const reopened = await openBook(root);
    expect(await recoverBook(reopened, appData)).toBe('external-change');
    expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe('правка третьей стороны');
    expect(await readFile(path.join(root, '01.review.json'), 'utf8')).toBe(reviewJson(ID1, '01.md'));
    expect(await readJournalsForRoot(appData, book.root)).toHaveLength(1);
  } finally {
    await cleanup(root, appData);
  }
});

test('a third external sidecar version stops recovery and overwrites nothing', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    const target: Pair = { source: NEXT_SOURCE, review: reviewJson(ID1, '01.md', 'обновлено') };
    await expect(writePairImpl(book, ID1, revision, target, appData, (s) => {
      if (s === 'prepared') throw new Error('injected crash');
    })).rejects.toThrow('injected crash');
    await writeFile(path.join(root, '01.review.json'), reviewJson(ID1, '01.md', 'третья версия sidecar'), 'utf8');
    const reopened = await openBook(root);
    expect(await recoverBook(reopened, appData)).toBe('external-change');
    expect(await readFile(path.join(root, '01.review.json'), 'utf8')).toBe(reviewJson(ID1, '01.md', 'третья версия sidecar'));
    expect(await readFile(path.join(root, '01.md'), 'utf8')).toBe(SOURCE_1);
    expect(await readJournalsForRoot(appData, book.root)).toHaveLength(1);
  } finally {
    await cleanup(root, appData);
  }
});

test('an externally replaced sidecar blocks a confirmed deletion', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    await expect(writePairImpl(book, ID1, revision, { source: NEXT_SOURCE, review: null }, appData, (s) => {
      if (s === 'prepared') throw new Error('injected crash');
    })).rejects.toThrow('injected crash');
    await writeFile(path.join(root, '01.review.json'), reviewJson(ID1, '01.md', 'чужая рецензия'), 'utf8');
    const reopened = await openBook(root);
    expect(await recoverBook(reopened, appData)).toBe('external-change');
    expect(await readFile(path.join(root, '01.review.json'), 'utf8')).toBe(reviewJson(ID1, '01.md', 'чужая рецензия'));
  } finally {
    await cleanup(root, appData);
  }
});

test('recoverBook reports clean for a book without journals', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    expect(await recoverBook(book, appData)).toBe('clean');
  } finally {
    await cleanup(root, appData);
  }
});

test('writePair refuses a symlinked chapter source and leaves the link target untouched', async () => {
  const root = await seedBook();
  const outside = await tempDir('galley-outside-');
  const appData = await tempDir('galley-appdata-');
  try {
    const outsideFile = path.join(outside, 'real.md');
    await writeFile(outsideFile, 'внешний файл', 'utf8');
    await unlink(path.join(root, '01.md'));
    await symlink(outsideFile, path.join(root, '01.md'));
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    expect(revision.sourceHash).toBe(sha256Hex(utf8Bytes('внешний файл')));
    const target: Pair = { source: NEXT_SOURCE, review: reviewJson(ID1, '01.md', 'обновлено') };
    await expect(writePair(book, ID1, revision, target, appData)).rejects.toBeInstanceOf(UnsafePathError);
    expect(await readFile(outsideFile, 'utf8')).toBe('внешний файл');
    expect((await lstat(path.join(root, '01.md'))).isSymbolicLink()).toBe(true);
  } finally {
    await cleanup(root, outside, appData);
  }
});

test('chapter paths that are not direct children are refused before any write', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    for (const evilPath of ['../escape.md', 'sub/01.md', '.']) {
      const evil: BookHandle = {
        ...book,
        manifest: { ...book.manifest, chapters: [{ id: ID2, path: evilPath, title: 'Evil' }] },
      };
      const target: Pair = { source: NEXT_SOURCE, review: null };
      await expect(readPair(evil, ID2)).rejects.toBeInstanceOf(UnsafePathError);
      await expect(writePair(evil, ID2, { sourceHash: 'x', reviewHash: null }, target, appData))
        .rejects.toBeInstanceOf(UnsafePathError);
    }
    expect(await exists(path.join(root, '..', 'escape.md'))).toBe(false);
    expect(await readdir(root)).not.toContain('sub');
  } finally {
    await cleanup(root, appData);
  }
});

test('concurrent writePair calls on one chapter serialize; the stale one conflicts', async () => {
  const root = await seedBook();
  const appData = await tempDir('galley-appdata-');
  try {
    const book = await openBook(root);
    const { revision } = await readPair(book, ID1);
    const first: Pair = { source: utf8Bytes('A'), review: reviewJson(ID1, '01.md', 'A') };
    const second: Pair = { source: utf8Bytes('B'), review: reviewJson(ID1, '01.md', 'B') };
    const outcomes = await Promise.allSettled([
      writePair(book, ID1, revision, first, appData),
      writePair(book, ID1, revision, second, appData),
    ]);
    expect(outcomes[0]?.status).toBe('fulfilled');
    expect(outcomes[1]?.status).toBe('rejected');
    const final = await readPair(book, ID1);
    expect(Buffer.from(final.pair.source).equals(Buffer.from(utf8Bytes('A')))).toBe(true);
    expect(final.pair.review).toBe(reviewJson(ID1, '01.md', 'A'));
    expect(await readJournalsForRoot(appData, book.root)).toEqual([]);
  } finally {
    await cleanup(root, appData);
  }
});

async function exists(absPath: string): Promise<boolean> {
  try {
    await lstat(absPath);
    return true;
  } catch {
    return false;
  }
}
