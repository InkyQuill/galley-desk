// Recent books list persisted in the appData directory. The stored record
// keeps the canonical folder path, title, book identity and the last reading
// position (chapter + scroll anchor); the renderer only ever sees the
// {path, title, missing} view. openRecent accepts paths from this list only —
// switching to a new location goes through the directory picker, matched by
// book_id.
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Recent } from '../shared/api';

const RECENT_FILE = 'recent-books.json';
const MAX_RECENT_BOOKS = 10;

/** One stored recent-book record; `path` is the canonical absolute folder. */
export type RecentBook = {
  path: string;
  bookId: string;
  title: string;
  lastChapterId: string | null;
  anchor: number | null;
  scrollTop: number | null;
  lastOpenedAt: number;
};

/** Canonical absolute path of an existing folder (symlinks resolved). */
export async function canonicalPath(folder: string): Promise<string> {
  return realpath(folder);
}

/**
 * Adds or refreshes a recent entry. Matching is by book_id: a folder that
 * moved (new path, same manifest identity) updates its existing record
 * instead of duplicating it. The newest entry comes first; the list stays
 * bounded by dropping the oldest records.
 */
export function upsertRecent(
  books: RecentBook[],
  opened: { path: string; bookId: string; title: string },
): RecentBook[] {
  const existing = books.find((book) => book.bookId === opened.bookId);
  const record: RecentBook = {
    path: opened.path,
    bookId: opened.bookId,
    title: opened.title,
    lastChapterId: existing?.lastChapterId ?? null,
    anchor: existing?.anchor ?? null,
    scrollTop: existing?.scrollTop ?? null,
    lastOpenedAt: Date.now(),
  };
  const rest = books.filter((book) => book.bookId !== opened.bookId && book.path !== opened.path);
  return [record, ...rest].slice(0, MAX_RECENT_BOOKS);
}

/**
 * Finds a stored entry for the requested folder. Existing paths are matched
 * by canonical comparison; a vanished folder cannot be re-resolved, so the
 * raw string is matched against the stored canonical path.
 */
export async function findRecentByCanonicalPath(
  books: RecentBook[],
  requested: string,
): Promise<RecentBook | undefined> {
  let canonical: string;
  try {
    canonical = await canonicalPath(requested);
  } catch {
    canonical = path.resolve(requested);
  }
  return books.find((book) => book.path === canonical);
}

/** Removes the entry for a folder; files on disk are never touched. */
export function forgetRecent(books: RecentBook[], requested: string, canonical?: string): RecentBook[] {
  const target = canonical ?? requested;
  return books.filter((book) => book.path !== target);
}

/** Stores the last opened chapter and scroll anchor for a registered book. */
export function updateRecentPosition(
  books: RecentBook[],
  bookId: string,
  chapterId: string,
  anchor: number,
  scrollTop: number,
): RecentBook[] {
  return books.map((book) =>
    book.bookId === bookId ? { ...book, lastChapterId: chapterId, anchor, scrollTop } : book,
  );
}

/** Renderer-visible view: existence of each folder checked on demand. */
export async function toRecentViews(books: RecentBook[]): Promise<Recent[]> {
  return Promise.all(
    books.map(async (book) => ({
      path: book.path,
      title: book.title,
      missing: !(await exists(book.path)),
    })),
  );
}

async function exists(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

/** Loads the stored list; a missing or corrupt file yields an empty list. */
export async function loadRecentBooks(appData: string): Promise<RecentBook[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(appData, RECENT_FILE), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentBook);
  } catch {
    return [];
  }
}

/** Persists the list atomically (temp file + rename inside appData). */
export async function saveRecentBooks(appData: string, books: RecentBook[]): Promise<void> {
  await mkdir(appData, { recursive: true });
  const target = path.join(appData, RECENT_FILE);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(books, null, 2), 'utf8');
  await rename(temp, target);
}

function isRecentBook(value: unknown): value is RecentBook {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<RecentBook>;
  return (
    typeof record.path === 'string' &&
    record.path.length > 0 &&
    typeof record.bookId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.lastOpenedAt === 'number' &&
    (record.lastChapterId === null || typeof record.lastChapterId === 'string') &&
    (record.anchor === null || typeof record.anchor === 'number') &&
    (record.scrollTop === null || typeof record.scrollTop === 'number')
  );
}
