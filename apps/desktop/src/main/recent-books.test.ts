import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  canonicalPath,
  forgetRecent,
  findRecentByCanonicalPath,
  loadRecentBooks,
  saveRecentBooks,
  toRecentViews,
  updateRecentPosition,
  upsertRecent,
  type RecentBook,
} from './recent-books';

const tempDirs: string[] = [];

async function tempAppData(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'galley-recent-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function entry(overrides: Partial<RecentBook> & { path: string; bookId: string }): RecentBook {
  return {
    title: 'Книга',
    lastChapterId: null,
    anchor: null,
    scrollTop: null,
    lastOpenedAt: 1,
    ...overrides,
  };
}

test('upsert adds a new entry first and refreshes by book_id when the folder moved', () => {
  const first = upsertRecent([], { path: '/books/a', bookId: 'id-1', title: 'А' });
  expect(first).toHaveLength(1);
  expect(first[0]?.path).toBe('/books/a');

  // Смена расположения: тот же book_id под новым путём — запись обновляется.
  const moved = upsertRecent(first, { path: '/books/b', bookId: 'id-1', title: 'А' });
  expect(moved).toHaveLength(1);
  expect(moved[0]?.path).toBe('/books/b');

  const second = upsertRecent(moved, { path: '/books/c', bookId: 'id-2', title: 'В' });
  expect(second).toHaveLength(2);
  expect(second[0]?.bookId).toBe('id-2');
});

test('upsert keeps the list bounded with the oldest entries dropped', () => {
  let books: RecentBook[] = [];
  for (let index = 0; index < 15; index++) {
    books = upsertRecent(books, { path: `/books/${index}`, bookId: `id-${index}`, title: String(index) });
  }
  expect(books).toHaveLength(10);
  expect(books[0]?.bookId).toBe('id-14');
  expect(books.map((book) => book.bookId)).not.toContain('id-0');
});

test('save/load roundtrip persists records; a corrupt file yields an empty list', async () => {
  const appData = await tempAppData();
  const books = upsertRecent([], { path: '/books/a', bookId: 'id-1', title: 'А' });
  await saveRecentBooks(appData, books);
  expect(await loadRecentBooks(appData)).toEqual(books);

  await writeFile(path.join(appData, 'recent-books.json'), '{ разбитый json');
  expect(await loadRecentBooks(appData)).toEqual([]);
  expect(await loadRecentBooks(await tempAppData())).toEqual([]);
});

test('canonicalPath resolves symlinks; find matches by canonical path and keeps raw fallback', async () => {
  const base = await tempAppData();
  const real = path.join(base, 'real-book');
  await mkdir(real);
  const link = path.join(base, 'link-book');
  await symlink(real, link);
  const canonical = await canonicalPath(link);
  expect(canonical).toBe(await realpath(real));

  const books = [entry({ path: canonical, bookId: 'id-1' })];
  expect((await findRecentByCanonicalPath(books, await canonicalPath(link)))?.bookId).toBe('id-1');

  // Папка исчезла: realpath невозможен, сравнение идёт по сохранённой строке.
  expect(await findRecentByCanonicalPath(books, canonical)).toBeDefined();
  expect(await findRecentByCanonicalPath(books, '/другая/книга')).toBeUndefined();
});

test('forget removes only the requested entry and never touches files', async () => {
  const base = await tempAppData();
  const bookDir = path.join(base, 'book');
  await mkdir(bookDir);
  const chapter = path.join(bookDir, 'Глава 1.md');
  await writeFile(chapter, '# Глава\n');

  const books = upsertRecent(
    [entry({ path: '/books/other', bookId: 'id-2', title: 'Другая' })],
    { path: await canonicalPath(bookDir), bookId: 'id-1', title: 'Книга' },
  );
  const kept = forgetRecent(books, bookDir);
  expect(kept).toHaveLength(1);
  expect(kept[0]?.bookId).toBe('id-2');
  expect(existsSync(chapter)).toBe(true);
  // Незнакомый путь ничего не удаляет.
  expect(forgetRecent(kept, '/незнакомый')).toHaveLength(1);
});

test('updateRecentPosition stores the last chapter and scroll anchor by book_id', () => {
  const books = upsertRecent([], { path: '/books/a', bookId: 'id-1', title: 'А' });
  const updated = updateRecentPosition(books, 'id-1', 'chapter-9', 42, 320);
  expect(updated[0]?.lastChapterId).toBe('chapter-9');
  expect(updated[0]?.anchor).toBe(42);
  expect(updated[0]?.scrollTop).toBe(320);
  // Неизвестная книга список не меняет.
  expect(updateRecentPosition(books, 'unknown', 'c', 0, 0)).toEqual(books);
});

test('toRecentViews reports missing folders and renderer-visible fields only', async () => {
  const base = await tempAppData();
  const present = path.join(base, 'present');
  await mkdir(present);
  const books = [
    entry({ path: present, bookId: 'id-1', title: 'Есть' }),
    entry({ path: path.join(base, 'исчезла'), bookId: 'id-2', title: 'Нет' }),
  ];
  const views = await toRecentViews(books);
  expect(views).toEqual([
    { path: present, title: 'Есть', missing: false },
    { path: path.join(base, 'исчезла'), title: 'Нет', missing: true },
  ]);
});
