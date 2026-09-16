import { describe, expect, it } from 'vitest';
import { book, findChapter } from './fixtures';

describe('fixtures', () => {
  it('has at least three openable chapters plus one missing chapter', () => {
    const openable = book.chapters.filter((chapter) => chapter.missing !== true);
    const missing = book.chapters.filter((chapter) => chapter.missing === true);
    expect(openable.length).toBeGreaterThanOrEqual(3);
    expect(missing.length).toBeGreaterThanOrEqual(1);
  });

  it('covers all four signal types across the fixture book', () => {
    const types = new Set(
      book.chapters.flatMap((chapter) => chapter.records).flatMap((r) => (r.kind === 'signal' ? [r.signalType] : [])),
    );
    expect(types).toEqual(new Set(['note', 'change_required', 'warning', 'review']));
  });

  it('places every record fully inside its chapter text', () => {
    for (const chapter of book.chapters) {
      for (const record of chapter.records) {
        expect(record.from).toBeGreaterThanOrEqual(0);
        expect(record.to).toBeLessThanOrEqual(chapter.text.length);
        expect(record.from).toBeLessThan(record.to);
      }
    }
  });

  it('finds a chapter by id and returns null for an unknown id', () => {
    const first = book.chapters[0]!;
    expect(findChapter(book, first.id)).toBe(first);
    expect(findChapter(book, 'no-such-chapter')).toBeNull();
  });
});
