import type { ChapterDiscovery, DeskApi } from '../../shared/api';

/** One subscription per open book; pushes supersede the initial discovery request. */
export function subscribeBookUpdates(
  api: Pick<DeskApi, 'onBookUpdate' | 'discoverChapters'>,
  bookId: string,
  receive: (update: ChapterDiscovery, isCurrent: () => boolean) => void,
): { dispose: () => void; invalidate: () => void; refresh: () => Promise<void> } {
  let active = true;
  let revision = 0;
  const accept = (update: ChapterDiscovery) => {
    if (!active || update.book.bookId !== bookId) return;
    const accepted = ++revision;
    receive(update, () => active && revision === accepted);
  };
  const unsubscribe = api.onBookUpdate(accept);
  const refresh = async () => {
    const requested = ++revision;
    const update = await api.discoverChapters(bookId);
    if (revision === requested) accept(update);
  };
  void refresh().catch(() => undefined);
  return {
    refresh,
    dispose: () => { active = false; unsubscribe(); },
    invalidate: () => { ++revision; },
  };
}
