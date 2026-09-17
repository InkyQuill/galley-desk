import type { BookView } from '../../shared/api';

const collator = new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' });

export function sortedChapterIds(entries: BookView['entries'], by: 'path' | 'title'): string[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftKey = by === 'title' ? left.entry.title || left.entry.path : left.entry.path;
      const rightKey = by === 'title' ? right.entry.title || right.entry.path : right.entry.path;
      return collator.compare(leftKey, rightKey) || left.index - right.index;
    })
    .map(({ entry }) => entry.id);
}
