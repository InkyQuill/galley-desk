import { expect, test } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  assertDirectChildName,
  replaceFileSynced,
  renameFileSynced,
  sha256Hex,
  tempNameFor,
  utf8Bytes,
  UnsafePathError,
  writeTempSibling,
} from './files';
import {
  decodeBytes,
  encodeBytes,
  journalFileName,
  journalPath,
  markJournalComplete,
  readJournalFile,
  readJournalsForRoot,
  removeJournal,
  writeJournal,
} from './journal';
import type { JournalRecord } from './journal';

const SOURCE_BYTES = utf8Bytes('# Глава\r\n\r\nпривет\n');
const REVIEW_BYTES = utf8Bytes('{"schema_version":1}\n');

function makeRecord(overrides?: Partial<JournalRecord>): JournalRecord {
  return {
    version: 1,
    root: '/books/alpha',
    chapter_id: '11111111-1111-4111-8111-111111111111',
    source_path: '01.md',
    review_path: '01.review.json',
    complete: false,
    before: { source: encodeBytes(SOURCE_BYTES), review: encodeBytes(REVIEW_BYTES) },
    after: { source: encodeBytes(utf8Bytes('# Глава 2\n')), review: null },
    ...overrides,
  };
}

async function makeAppData(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'galley-appdata-'));
}

test('encoded bytes round-trip exactly, including CRLF and non-ASCII', () => {
  const encoded = encodeBytes(SOURCE_BYTES);
  expect(encoded.sha256).toBe(sha256Hex(SOURCE_BYTES));
  expect(decodedEqual(encoded, SOURCE_BYTES)).toBe(true);
});

function decodedEqual(encoded: { base64: string }, raw: Uint8Array): boolean {
  return Buffer.from(decodedBytes(encoded)).equals(Buffer.from(raw));
}

function decodedBytes(encoded: { base64: string }): Uint8Array {
  return decodeBytes({ base64: encoded.base64, sha256: '' });
}

test('journal file name is deterministic per root and chapter, distinct otherwise', () => {
  const first = journalFileName('/books/alpha', '11111111-1111-4111-8111-111111111111');
  expect(journalFileName('/books/alpha', '11111111-1111-4111-8111-111111111111')).toBe(first);
  expect(journalFileName('/books/alpha', '22222222-2222-4222-8222-222222222222')).not.toBe(first);
  expect(journalFileName('/books/beta', '11111111-1111-4111-8111-111111111111')).not.toBe(first);
  expect(first).toMatch(/^galley-journal-[0-9a-f]{32}\.json$/);
});

test('writeJournal persists the exact record at the final path without temp leftovers', async () => {
  const appData = await makeAppData();
  const nested = path.join(appData, 'journals');
  const record = makeRecord();
  await writeJournal(nested, record);
  const stored = await readJournalFile(journalPath(nested, record.root, record.chapter_id));
  expect(stored).toEqual(record);
  expect(await readdir(nested)).toEqual([journalFileName(record.root, record.chapter_id)]);
  await rm(nested, { recursive: true, force: true });
});

test('readJournalFile rejects an unreadable journal instead of guessing', async () => {
  const appData = await makeAppData();
  const broken = path.join(appData, journalFileName('/books/alpha', '11111111-1111-4111-8111-111111111111'));
  await writeFile(broken, '{ truncated', 'utf8');
  await expect(readJournalFile(broken)).rejects.toThrow(/Unreadable journal/);
  await rm(appData, { recursive: true, force: true });
});

test('readJournalsForRoot returns only journals of the requested book, sorted', async () => {
  const appData = await makeAppData();
  await writeJournal(appData, makeRecord());
  await writeJournal(appData, makeRecord({
    chapter_id: '22222222-2222-4222-8222-222222222222',
    source_path: '02.md',
    review_path: '02.review.json',
  }));
  await writeJournal(appData, makeRecord({ root: '/books/beta' }));
  const alpha = await readJournalsForRoot(appData, '/books/alpha');
  expect(alpha).toHaveLength(2);
  expect(alpha.map((record) => record.chapter_id)).toEqual([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ]);
  expect(await readJournalsForRoot(appData, '/books/missing')).toEqual([]);
  await rm(appData, { recursive: true, force: true });
});

test('readJournalsForRoot tolerates a missing appData directory', async () => {
  expect(await readJournalsForRoot('/galley-definitely-missing-appdata', '/books/alpha')).toEqual([]);
});

test('markJournalComplete persists complete=true and removeJournal deletes the file', async () => {
  const appData = await makeAppData();
  const record = makeRecord();
  await writeJournal(appData, record);
  await markJournalComplete(appData, record);
  const stored = await readJournalFile(journalPath(appData, record.root, record.chapter_id));
  expect(stored.complete).toBe(true);
  await removeJournal(appData, record.root, record.chapter_id);
  expect(await readJournalsForRoot(appData, record.root)).toEqual([]);
  await expect(removeJournal(appData, record.root, record.chapter_id)).resolves.toBeUndefined();
  await rm(appData, { recursive: true, force: true });
});

test('temp names live in the book folder but never look like book files', () => {
  for (const dest of ['01.md', '01.review.json', '.pocket-editor.json']) {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const name = tempNameFor(dest);
      expect(name.startsWith('.')).toBe(true);
      expect(name.endsWith('.md')).toBe(false);
      expect(name.endsWith('.review.json')).toBe(false);
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
  }
});

test('direct child names: traversal, nesting and separators are rejected', () => {
  expect(() => assertDirectChildName('01.md')).not.toThrow();
  expect(() => assertDirectChildName('.hidden.md')).not.toThrow();
  expect(() => assertDirectChildName('')).toThrow(UnsafePathError);
  expect(() => assertDirectChildName('.')).toThrow(UnsafePathError);
  expect(() => assertDirectChildName('..')).toThrow(UnsafePathError);
  expect(() => assertDirectChildName('../escape.md')).toThrow(UnsafePathError);
  expect(() => assertDirectChildName('sub/01.md')).toThrow(UnsafePathError);
  expect(() => assertDirectChildName('sub\\01.md')).toThrow(UnsafePathError);
  expect(() => assertDirectChildName('/etc/passwd')).toThrow(UnsafePathError);
});

test('replaceFileSynced lands exact bytes at the destination via real rename', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'galley-files-'));
  const dest = path.join(dir, '01.md');
  await writeFile(dest, 'old bytes\r\n', 'utf8');
  await replaceFileSynced(dir, '01.md', SOURCE_BYTES);
  const stored = new Uint8Array(await readFile(dest));
  expect(Buffer.from(stored).equals(Buffer.from(SOURCE_BYTES))).toBe(true);
  expect(await readdir(dir)).toEqual(['01.md']);
  await rm(dir, { recursive: true, force: true });
});

test('writeTempSibling plus renameFileSynced moves the synced temp onto the target', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'galley-files-'));
  const tmp = await writeTempSibling(dir, '01.review.json', REVIEW_BYTES);
  expect(path.dirname(tmp)).toBe(dir);
  await renameFileSynced(dir, tmp, path.join(dir, '01.review.json'));
  const stored = new Uint8Array(await readFile(path.join(dir, '01.review.json')));
  expect(Buffer.from(stored).equals(Buffer.from(REVIEW_BYTES))).toBe(true);
  expect(await readdir(dir)).toEqual(['01.review.json']);
  await rm(dir, { recursive: true, force: true });
});
