import { expect, test } from 'vitest';
import { displayOffsetToDerived, rebaseViewport } from './reading-position';
import { derivedRangeToDisplayRange, type ComparisonSegment } from '../search/search';

for (const [before, after] of [['', 'нов🙂'], ['стар🙂', ''], ['стар🙂', 'нов🙂']]) {
  test(`UTF-16 display mapping: ${before} → ${after}`, () => {
    const from = 4;
    const end = from + after!.length;
    const displayEnd = from + before!.length + after!.length;
    const segments: ComparisonSegment[] = [
      { kind: 'text', derivedFrom: 0, derivedTo: from, displayStart: 0 },
      { kind: 'edit', derivedFrom: from, derivedTo: end, displayStart: from, beforeLength: before!.length },
      { kind: 'text', derivedFrom: end, derivedTo: end + 3, displayStart: displayEnd },
    ];
    expect(displayOffsetToDerived(segments, 3)).toBe(3);
    for (let i = 0; i < before!.length; i++) expect(displayOffsetToDerived(segments, from + i)).toBe(from);
    for (let i = 0; i <= after!.length; i++) expect(displayOffsetToDerived(segments, from + before!.length + i)).toBe(from + i);
    expect(displayOffsetToDerived(segments, displayEnd + 2)).toBe(end + 2);
    expect(displayOffsetToDerived(segments, displayEnd + 3)).toBe(end + 3);
    expect(displayOffsetToDerived(segments, displayEnd + 4)).toBeNull();
    for (let i = 0; i <= end + 3; i++) {
      const display = derivedRangeToDisplayRange(segments, i, i)!;
      expect(displayOffsetToDerived(segments, display.from)).toBe(i);
    }
  });
}

test('empty document, deleted EOF, invalid offsets', () => {
  expect(displayOffsetToDerived([], 0)).toBe(0);
  expect(displayOffsetToDerived([], 1)).toBeNull();
  const deletion: ComparisonSegment[] = [{ kind: 'edit', derivedFrom: 0, derivedTo: 0, displayStart: 0, beforeLength: 4 }];
  expect(displayOffsetToDerived(deletion, 4)).toBe(0);
  expect(displayOffsetToDerived(deletion, 2)).toBe(0);
  for (const offset of [-1, NaN, Infinity]) expect(displayOffsetToDerived(deletion, offset)).toBeNull();
});

test('viewport rebases through snapshot changes and clamps deleted reading text', () => {
  expect(rebaseViewport({ derivedOffset: 5, topOffset: -3 }, 'Old\nReading\n', 'Reading\n')).toEqual({ derivedOffset: 1, topOffset: -3 });
  expect(rebaseViewport({ derivedOffset: 9, topOffset: 2 }, 'Old\nReading\n', '')).toEqual({ derivedOffset: 0, topOffset: 2 });
});
