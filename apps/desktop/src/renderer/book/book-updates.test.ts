import { expect, test, vi } from 'vitest';
import type { ChapterDiscovery } from '../../shared/api';
import { subscribeBookUpdates } from './book-updates';

const update = (title: string, error?: string): ChapterDiscovery => ({
  book: { bookId: 'book', path: '/book', title, entries: [] },
  files: [{ path: `${title}.md` }],
  ...(error ? { error } : {}),
});

function harness() {
  let push: (value: ChapterDiscovery) => void = () => undefined;
  let resolve: (value: ChapterDiscovery) => void = () => undefined;
  const initial = new Promise<ChapterDiscovery>(done => { resolve = done; });
  const unsubscribe = vi.fn();
  const api = {
    onBookUpdate: vi.fn((listener: typeof push) => { push = listener; return unsubscribe; }),
    discoverChapters: vi.fn(() => initial),
  };
  return { api, push: (value: ChapterDiscovery) => push(value), resolve, unsubscribe };
}

test('a late initial response cannot clear newer files or binder errors', async () => {
  const h = harness();
  const receive = vi.fn();
  const stop = subscribeBookUpdates(h.api, 'book', receive);
  const newer = update('new', 'Invalid binder');
  h.push(newer);
  h.resolve(update('old'));
  await Promise.resolve();
  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive.mock.calls[0]?.[0]).toEqual(newer);
  expect(h.api.discoverChapters).toHaveBeenCalledTimes(1);
  stop();
  expect(h.unsubscribe).toHaveBeenCalledOnce();
});

test('new updates invalidate work awaiting an editor flush, and closing invalidates all work', async () => {
  const h = harness();
  const pending: Array<{ title: string; isCurrent: () => boolean }> = [];
  const stop = subscribeBookUpdates(h.api, 'book', (value, isCurrent) => {
    pending.push({ title: value.book.title, isCurrent });
  });
  h.resolve(update('initial'));
  await Promise.resolve();
  h.push(update('next'));
  expect(pending.filter(item => item.isCurrent()).map(item => item.title)).toEqual(['next']);
  stop();
  h.push(update('closed'));
  expect(pending).toHaveLength(2);
  expect(pending.some(item => item.isCurrent())).toBe(false);
});

test('unrelated books do not suppress initial discovery and closed requests are ignored', async () => {
  const h = harness();
  const receive = vi.fn();
  const stop = subscribeBookUpdates(h.api, 'book', receive);
  const other = update('other');
  h.push({ ...other, book: { ...other.book, bookId: 'other' } });
  h.resolve(update('initial'));
  await Promise.resolve();
  expect(receive).toHaveBeenCalledTimes(1);
  stop();
  const late = harness();
  subscribeBookUpdates(late.api, 'book', receive)();
  late.resolve(update('closed'));
  await Promise.resolve();
  expect(receive).toHaveBeenCalledTimes(1);
});
