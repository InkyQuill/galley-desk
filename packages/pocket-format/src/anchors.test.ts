import { expect, test } from 'vitest';
import { makeAnchor, resolveAnchor, sha256 } from './anchors';
import type { Anchor } from './documents';

test('uses byte offsets without normalizing CRLF', () => {
  const source = new TextEncoder().encode('я🙂\r\nкот');
  const anchor = makeAnchor(source, { from: 8, to: 14 });
  expect(anchor.start_line).toBe(2);
  expect(resolveAnchor(source, anchor, 'кот')).toEqual({
    kind: 'resolved', range: { from: 8, to: 14 }
  });
});

test('counts context windows in code points, not UTF-16 units', () => {
  const head = '🙂'.repeat(130);
  const tail = 'a'.repeat(130);
  const source = new TextEncoder().encode(`${head}TARGET${tail}`);
  const from = new TextEncoder().encode(head).length;
  const anchor = makeAnchor(source, { from, to: from + 6 });
  expect(Array.from(anchor.prefix)).toHaveLength(128);
  expect(anchor.prefix.startsWith('🙂')).toBe(true);
  expect(Array.from(anchor.suffix)).toHaveLength(128);
});

test('rejects boundaries that split a code point', () => {
  const source = new TextEncoder().encode('я кот');
  expect(() => makeAnchor(source, { from: 1, to: 4 })).toThrow(
    'Anchor byte offsets must align to UTF-8 code-point boundaries',
  );
});

test('rejects malformed UTF-8 source', () => {
  const source = Uint8Array.of(0xd1, 0x8f, 0xff, 0x20);
  expect(() => makeAnchor(source, { from: 3, to: 4 })).toThrow();
});

test('rejects empty, reversed and out of bounds ranges', () => {
  const source = new TextEncoder().encode('cat');
  expect(() => makeAnchor(source, { from: 2, to: 2 })).toThrow();
  expect(() => makeAnchor(source, { from: 3, to: 1 })).toThrow();
  expect(() => makeAnchor(source, { from: -1, to: 2 })).toThrow();
  expect(() => makeAnchor(source, { from: 0, to: 4 })).toThrow();
});

test('line hints count raw newline bytes', () => {
  const source = new TextEncoder().encode('one\r\ntwo\nthree');
  const anchor = makeAnchor(source, { from: 5, to: 14 });
  expect(anchor.start_line).toBe(2);
  expect(anchor.end_line).toBe(3);
});

test('stale when selected text does not match the selection hash', () => {
  const source = new TextEncoder().encode('cat dog');
  const anchor = makeAnchor(source, { from: 0, to: 3 });
  expect(resolveAnchor(source, anchor, 'dog')).toEqual({ kind: 'stale' });
  expect(resolveAnchor(source, anchor, '')).toEqual({ kind: 'stale' });
});

test('prefers the saved range when the source hash matches', () => {
  const source = new TextEncoder().encode('cat cat');
  const anchor = makeAnchor(source, { from: 4, to: 7 });
  expect(resolveAnchor(source, anchor, 'cat')).toEqual({
    kind: 'resolved', range: { from: 4, to: 7 },
  });
});

test('stale on same hash when saved bytes no longer hold the selection', () => {
  const source = new TextEncoder().encode('cat dog');
  const anchor = { ...makeAnchor(source, { from: 0, to: 3 }), end_byte: 7, end_line: 1 };
  expect(resolveAnchor(source, anchor, 'cat')).toEqual({ kind: 'stale' });
});

test('finds the single occurrence after the source changed', () => {
  const before = new TextEncoder().encode('cat sleeps');
  const after = new TextEncoder().encode('yellow cat sleeps');
  const anchor = makeAnchor(before, { from: 0, to: 3 });
  expect(resolveAnchor(after, anchor, 'cat')).toEqual({
    kind: 'resolved', range: { from: 7, to: 10 },
  });
});

test('stale when the selection is gone from the changed source', () => {
  const before = new TextEncoder().encode('cat sleeps');
  const after = new TextEncoder().encode('dog sleeps');
  const anchor = makeAnchor(before, { from: 0, to: 3 });
  expect(resolveAnchor(after, anchor, 'cat')).toEqual({ kind: 'stale' });
});

test('ambiguous with all occurrences when no context matches', () => {
  const before = new TextEncoder().encode('cat');
  const after = new TextEncoder().encode('cat cat cat');
  const anchor = makeAnchor(before, { from: 0, to: 3 });
  expect(resolveAnchor(after, anchor, 'cat')).toEqual({
    kind: 'ambiguous',
    candidates: [
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ],
  });
});

test('prefix and suffix context disambiguate an occurrence', () => {
  const before = new TextEncoder().encode('one cat two');
  const after = new TextEncoder().encode('cat one cat two cat');
  const anchor = makeAnchor(before, { from: 4, to: 7 });
  expect(resolveAnchor(after, anchor, 'cat')).toEqual({
    kind: 'resolved', range: { from: 8, to: 11 },
  });
});

test('ambiguous among contextual occurrences when several match context', () => {
  const before = new TextEncoder().encode('cat');
  const after = new TextEncoder().encode('cat a cat a');
  const anchor = makeAnchor(before, { from: 0, to: 3 });
  expect(resolveAnchor(after, anchor, 'cat')).toEqual({
    kind: 'ambiguous',
    candidates: [
      { from: 0, to: 3 },
      { from: 6, to: 9 },
    ],
  });
});

test('unsafe offsets leave a same-hash anchor stale', () => {
  const source = new TextEncoder().encode('кот');
  const anchor: Anchor = JSON.parse(`{
    "source_sha256": "${sha256(source)}",
    "selection_sha256": "${sha256(new TextEncoder().encode('кот'))}",
    "start_byte": 9007199254740993,
    "end_byte": 9007199254740996,
    "start_line": 1,
    "end_line": 1,
    "prefix": "",
    "suffix": ""
  }`);
  expect(Number.isSafeInteger(anchor.start_byte)).toBe(false);
  expect(resolveAnchor(source, anchor, 'кот')).toEqual({ kind: 'stale' });
});

test('stale on an empty source', () => {
  const anchor = makeAnchor(new TextEncoder().encode('cat'), { from: 0, to: 3 });
  expect(resolveAnchor(new TextEncoder().encode(''), anchor, 'cat')).toEqual({ kind: 'stale' });
});

test('selection hash uses exact bytes including CRLF', () => {
  const source = new TextEncoder().encode('a\r\nb');
  const anchor = makeAnchor(source, { from: 1, to: 3 });
  expect(anchor.selection_sha256).toBe(sha256(Uint8Array.of(0x0d, 0x0a)));
  expect(resolveAnchor(source, anchor, '\r\n')).toEqual({
    kind: 'resolved', range: { from: 1, to: 3 },
  });
});
