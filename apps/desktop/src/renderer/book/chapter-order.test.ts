import { expect, test } from 'vitest';
import type { BookView } from '../../shared/api';
import { sortedChapterIds } from './chapter-order';

const entries: BookView['entries'] = [
  { id: 'ten', path: '10.md', title: 'Глава', missing: false },
  { id: 'two', path: '2.md', title: 'Глава', missing: false },
  { id: 'empty', path: '3.md', title: '', missing: true },
];

test('sorts paths naturally and keeps equal keys stable', () => {
  expect(sortedChapterIds(entries, 'path')).toEqual(['two', 'empty', 'ten']);
});

test('sorts titles naturally, falls back to path, and keeps equal titles stable', () => {
  expect(sortedChapterIds(entries, 'title')).toEqual(['empty', 'ten', 'two']);
});
