import { expect, test } from 'vitest';
import { makeAnchor } from '@galley-desk/pocket-format';
import type { Review } from '@galley-desk/pocket-format';
import { openChapter, sourceRange } from './index';

test('openChapter without edits derives one unchanged source piece', () => {
  const source = new TextEncoder().encode('кот');
  const model = openChapter(source, emptyReview());
  expect(model.text).toBe('кот');
  expect(model.pieces).toEqual([{ text: 'кот', source: { from: 0, to: 6 } }]);
  expect(model.selection).toEqual({ anchor: 0, head: 0 });
});

test('openChapter applies the active edit between unchanged source slices', () => {
  const source = new TextEncoder().encode('кот');
  const review = emptyReview({ edits: [edit('e1', 'о', 'и', source, 2, 4)] });
  const model = openChapter(source, review);
  expect(model.text).toBe('кит');
  expect(model.pieces).toEqual([
    { text: 'к', source: { from: 0, to: 2 } },
    { text: 'и', source: { from: 2, to: 4 }, editId: 'e1' },
    { text: 'т', source: { from: 4, to: 6 } },
  ]);
});

test('stale and conflicting records stay in review but never reach pieces', () => {
  const source = new TextEncoder().encode('кот');
  const stale = edit('e2', 'z', 'y', source, 2, 4);
  const conflictA = edit('e3', 'о', 'a', source, 2, 4);
  const conflictB = edit('e4', 'о', 'b', source, 2, 4);
  const review = emptyReview({ edits: [conflictB, stale, conflictA] });
  const model = openChapter(source, review);
  expect(model.text).toBe('кот');
  expect(model.pieces).toEqual([{ text: 'кот', source: { from: 0, to: 6 } }]);
  expect([...model.review.edits].map((record) => record.id).sort()).toEqual(['e2', 'e3', 'e4']);
});

test('sourceRange inside a replacement resolves to the whole edit range', () => {
  const source = new TextEncoder().encode('кот');
  const review = emptyReview({ edits: [edit('e1', 'о', 'XY', source, 2, 4)] });
  const model = openChapter(source, review);
  expect(model.text).toBe('кXYт');
  expect(sourceRange(model, 2, 3)).toEqual({ from: 2, to: 4 });
  expect(sourceRange(model, 1, 3)).toEqual({ from: 2, to: 4 });
});

test('sourceRange of a mixed selection covers the entire source span', () => {
  const source = new TextEncoder().encode('кот');
  const review = emptyReview({ edits: [edit('e1', 'о', 'XY', source, 2, 4)] });
  const model = openChapter(source, review);
  expect(sourceRange(model, 0, 4)).toEqual({ from: 0, to: 6 });
});

test('sourceRange inside unchanged text maps to exact UTF-8 byte offsets', () => {
  const source = new TextEncoder().encode('котик');
  const model = openChapter(source, emptyReview());
  expect(sourceRange(model, 1, 3)).toEqual({ from: 2, to: 6 });
  expect(sourceRange(model, 0, 5)).toEqual({ from: 0, to: 10 });
});

function edit(id: string, before: string, after: string, source: Uint8Array, from: number, to: number) {
  return { id, before, after, anchor: makeAnchor(source, { from, to }) };
}

function emptyReview(fields?: Partial<Review>): Review {
  return {
    schema_version: 1,
    chapter_id: '11111111-1111-4111-8111-111111111111',
    source_path: '01.md',
    chapter_note: '',
    edits: [],
    signals: [],
    ...fields,
  };
}
