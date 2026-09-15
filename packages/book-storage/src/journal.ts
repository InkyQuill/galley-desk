import { mkdir, readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { replaceFileSynced, sha256Hex, unlinkIfPresent, utf8Bytes, utf8Text } from './files';

/**
 * Local crash journal for two-file (source + sidecar) replacements. The
 * journal lives in the appData directory, never in the book folder: the book
 * stays a portable source of truth and there is no portable journal format.
 *
 * One journal file per (book root, chapter) is enough because writes to a
 * chapter are serialized. The record carries the full before/after bytes so
 * recovery can finish or discard an interrupted operation without guessing.
 */
export type JournalBytes = { base64: string; sha256: string };

export type JournalSide = { source: JournalBytes; review: JournalBytes | null };

export type JournalRecord = {
  version: 1;
  root: string;
  chapter_id: string;
  source_path: string;
  review_path: string;
  complete: boolean;
  before: JournalSide;
  after: JournalSide;
};

export function encodeBytes(bytes: Uint8Array): JournalBytes {
  return { base64: Buffer.from(bytes).toString('base64'), sha256: sha256Hex(bytes) };
}

export function decodeBytes(value: JournalBytes): Uint8Array {
  return new Uint8Array(Buffer.from(value.base64, 'base64'));
}

const JOURNAL_PREFIX = 'galley-journal-';
const JOURNAL_PATTERN = /^galley-journal-[0-9a-f]{32}\.json$/;

export function journalFileName(root: string, chapterId: string): string {
  return `${JOURNAL_PREFIX}${sha256Hex(utf8Bytes(`${root}\n${chapterId}`)).slice(0, 32)}.json`;
}

export function journalPath(appData: string, root: string, chapterId: string): string {
  return path.join(appData, journalFileName(root, chapterId));
}

export async function writeJournal(appData: string, record: JournalRecord): Promise<void> {
  await mkdir(appData, { recursive: true });
  await replaceFileSynced(appData, journalFileName(record.root, record.chapter_id), utf8Bytes(JSON.stringify(record)));
}

export async function readJournalFile(absPath: string): Promise<JournalRecord> {
  let record: JournalRecord;
  try {
    record = JSON.parse(utf8Text(new Uint8Array(await readFile(absPath)))) as JournalRecord;
  } catch (error) {
    throw new Error(`Unreadable journal file ${absPath}: ${(error as Error).message}`);
  }
  const shaped = record !== null && typeof record === 'object' &&
    record.version === 1 &&
    typeof record.root === 'string' &&
    typeof record.chapter_id === 'string' &&
    typeof record.source_path === 'string' &&
    typeof record.review_path === 'string' &&
    record.before !== null && typeof record.before === 'object' &&
    record.before.source !== null && typeof record.before.source === 'object' &&
    record.after !== null && typeof record.after === 'object' &&
    record.after.source !== null && typeof record.after.source === 'object';
  if (!shaped) {
    throw new Error(`Unreadable journal file ${absPath}: unexpected record shape`);
  }
  return record;
}

export async function readJournalsForRoot(appData: string, root: string): Promise<JournalRecord[]> {
  let names: string[];
  try {
    names = await readdir(appData);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: JournalRecord[] = [];
  for (const name of names.filter((candidate) => JOURNAL_PATTERN.test(candidate)).sort()) {
    const record = await readJournalFile(path.join(appData, name));
    if (record.root === root) records.push(record);
  }
  return records;
}

export async function markJournalComplete(appData: string, record: JournalRecord): Promise<void> {
  await replaceFileSynced(
    appData,
    journalFileName(record.root, record.chapter_id),
    utf8Bytes(JSON.stringify({ ...record, complete: true })),
  );
}

export async function removeJournal(appData: string, root: string, chapterId: string): Promise<void> {
  await unlinkIfPresent(journalPath(appData, root, chapterId));
}
