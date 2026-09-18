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

test('rebase preserves unchanged interior when both sides change during flush', () => {
  const before = 'Inserted above\nReading🙂 passage\nInserted below\n';
  const after = 'Reading🙂 passage\n';
  expect(rebaseViewport({ derivedOffset: before.indexOf('🙂'), topOffset: 3 }, before, after)).toEqual({ derivedOffset: after.indexOf('🙂'), topOffset: 3 });
});

test('separated replacements retain an interior UTF-16 position on one line', () => {
  const before = 'old prefix — читаю🙂 здесь — old suffix';
  const after = 'new beginning — читаю🙂 здесь — new ending';
  expect(rebaseViewport({ derivedOffset: before.indexOf('здесь'), topOffset: -2 }, before, after)).toEqual({ derivedOffset: after.indexOf('здесь'), topOffset: -2 });
});

test('repeated lines retain their order and EOF maps through several edits', () => {
  const before = 'Remove above\nповтор\nчитаю🙂\nповтор\nRemove below\n';
  const after = 'повтор\nчитаю🙂\nповтор\n';
  expect(rebaseViewport({ derivedOffset: before.indexOf('читаю'), topOffset: 0 }, before, after).derivedOffset).toBe(after.indexOf('читаю'));
  expect(rebaseViewport({ derivedOffset: before.lastIndexOf('повтор'), topOffset: 0 }, before, after).derivedOffset).toBe(after.lastIndexOf('повтор'));
  expect(rebaseViewport({ derivedOffset: before.length, topOffset: 0 }, before, after).derivedOffset).toBe(after.length);
});

test('deleted anchors clamp at the edit while unchanged surrogate code units survive', () => {
  const before = 'head\nremove🙂\nkeep🙂here\ntail\n';
  const after = 'head\nkeep🙂here\nchanged tail\n';
  expect(rebaseViewport({ derivedOffset: before.indexOf('remove') + 3, topOffset: 4 }, before, after)).toEqual({ derivedOffset: 5, topOffset: 4 });
  const position = before.indexOf('🙂', before.indexOf('keep')) + 1;
  expect(rebaseViewport({ derivedOffset: position, topOffset: 0 }, before, after).derivedOffset).toBe(after.indexOf('🙂') + 1);
});

test('bounded fallback retains proven prefix and suffix on a wholesale rewrite', () => {
  const before = 'Keep\n' + 'old unrelated content\n'.repeat(10_000) + 'End\n';
  const after = 'Keep\n' + 'new different content\n'.repeat(10_000) + 'End\n';
  expect(rebaseViewport({ derivedOffset: 2, topOffset: 0 }, before, after).derivedOffset).toBe(2);
  expect(rebaseViewport({ derivedOffset: before.length - 2, topOffset: 0 }, before, after).derivedOffset).toBe(after.length - 2);
  const result = rebaseViewport({ derivedOffset: 100, topOffset: -3 }, before, after);
  expect(result).toEqual({ derivedOffset: 5, topOffset: -3 });
});

test('multiple separated edits keep every surviving line, including insertion boundaries', () => {
  const lines = Array.from({ length: 32 }, (_, i) => `Line ${i} 🙂\n`);
  const changed = lines.flatMap((line, i) => [3, 12, 29].includes(i) ? [] : i === 22 ? ['Replacement\n'] : i === 17 ? ['Added\n', line] : [line]);
  const before = lines.join('');
  const after = changed.join('');
  for (const [index, line] of lines.entries()) {
    if ([3, 12, 22, 29].includes(index)) continue;
    for (const shift of [0, 2, line.length - 2]) {
      expect(rebaseViewport({ derivedOffset: before.indexOf(line) + shift, topOffset: 0 }, before, after).derivedOffset).toBe(after.indexOf(line) + shift);
    }
  }
});

test('a unique unchanged reading line survives separated edits larger than the diff budget', () => {
  const before = 'Removed above\n'.repeat(1_000) + 'Уникальное место🙂 чтения\n' + 'Removed below\n'.repeat(1_000);
  const after = 'Inserted above\n'.repeat(1_000) + 'Уникальное место🙂 чтения\n' + 'Inserted below\n'.repeat(1_000);
  expect(rebaseViewport({ derivedOffset: before.indexOf('место'), topOffset: 3 }, before, after)).toEqual({ derivedOffset: after.indexOf('место'), topOffset: 3 });
});

test('ordered repeated-line anchors follow insertions at their exact boundary', () => {
  const before = 'a\nrepeat\nb\nrepeat\nc\n';
  const after = 'a\nNEW\nrepeat\nb\nrepeat\nCHANGED\nc\n';
  for (const position of [before.indexOf('repeat'), before.lastIndexOf('repeat')]) {
    const expected = position === before.indexOf('repeat') ? after.indexOf('repeat') : after.lastIndexOf('repeat');
    expect(rebaseViewport({ derivedOffset: position, topOffset: 0 }, before, after).derivedOffset).toBe(expected);
  }
});
