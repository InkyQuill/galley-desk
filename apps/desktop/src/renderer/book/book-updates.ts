import type { ChapterDiscovery, DeskApi } from '../../shared/api';

/** One subscription per open book; pushes supersede the initial discovery request. */
export function subscribeBookUpdates(
  api: Pick<DeskApi, 'onBookUpdate' | 'discoverChapters'>,
  bookId: string,
  receive: (update: ChapterDiscovery, isCurrent: () => boolean) => void,
): { dispose: () => void; invalidate: () => void } {
  let active = true;
  let revision = 0;
  const accept = (update: ChapterDiscovery) => {
    if (!active || update.book.bookId !== bookId) return;
    const accepted = ++revision;
    receive(update, () => active && revision === accepted);
  };
  const unsubscribe = api.onBookUpdate(accept);
  const initialRevision = revision;
  void api.discoverChapters(bookId).then(update => {
    if (revision === initialRevision) accept(update);
  }).catch(() => undefined);
  return {
    dispose: () => { active = false; unsubscribe(); },
    invalidate: () => { ++revision; },
  };
}
