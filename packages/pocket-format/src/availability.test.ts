import { expect, test } from 'vitest';
import { makeAnchor } from './anchors';
import { classifyReview } from './availability';
import type { Review, Signal } from './documents';

const SOURCE = 'one two three four five';

function anchorOn(source: string, from: number, to: number) {
  return makeAnchor(new TextEncoder().encode(source), { from, to });
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    schema_version: 1,
    chapter_id: '11111111-1111-4111-8111-111111111111',
    source_path: '01.md',
    chapter_note: '',
    edits: [],
    signals: [],
    ...overrides,
  };
}

test('collects resolved ranges for active edits and signals', () => {
  const value = review({
    edits: [{
      id: '22222222-2222-4222-8222-222222222222',
      before: 'two',
      after: 'два',
      anchor: anchorOn(SOURCE, 4, 7),
    }],
    signals: [({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'note',
      selected_text: 'four',
      anchor: anchorOn(SOURCE, 14, 18),
      comment: '',
    }) as Signal],
  });
  const availability = classifyReview(new TextEncoder().encode(SOURCE), value);
  expect(availability.edits.get('22222222-2222-4222-8222-222222222222')).toEqual({ from: 4, to: 7 });
  expect(availability.signals.get('33333333-3333-4333-8333-333333333333')).toEqual({ from: 14, to: 18 });
  expect(availability.unavailable.size).toBe(0);
  expect(availability.conflicting.size).toBe(0);
});

test('unresolved records go to unavailable with their resolution', () => {
  const source = 'two and two again';
  const value = review({
    edits: [{
      id: '22222222-2222-4222-8222-222222222222',
      before: 'gone',
      after: 'тут',
      anchor: anchorOn('gone text', 0, 4),
    }],
    signals: [({
      id: '33333333-3333-4333-8333-333333333333',
      type: 'note',
      selected_text: 'two',
      anchor: anchorOn('two two two', 0, 3),
      comment: '',
    }) as Signal],
  });
  const availability = classifyReview(new TextEncoder().encode(source), value);
  expect(availability.edits.size).toBe(0);
  expect(availability.signals.size).toBe(0);
  expect(availability.unavailable.get('22222222-2222-4222-8222-222222222222')).toEqual({ kind: 'stale' });
  expect(availability.unavailable.get('33333333-3333-4333-8333-333333333333')).toEqual({
    kind: 'ambiguous',
    candidates: [
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ],
  });
});

test('excludes every participant of an edit intersection chain', () => {
  // A: 0..9, B: 5..15, C: 10..19 — A overlaps B, B overlaps C, A and C do not.
  const source = 'aaaa bbbbb cccc d';
  const value = review({
    edits: [
      { id: '22222222-2222-4222-8222-222222222222', before: source.slice(0, 9), after: 'A', anchor: anchorOn(source, 0, 9) },
      { id: '33333333-3333-4333-8333-333333333333', before: source.slice(5, 15), after: 'B', anchor: anchorOn(source, 5, 15) },
      { id: '44444444-4444-4444-8444-444444444444', before: source.slice(10, 17), after: 'C', anchor: anchorOn(source, 10, 17) },
    ],
  });
  const availability = classifyReview(new TextEncoder().encode(source), value);
  expect([...availability.conflicting].sort()).toEqual([
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ]);
  expect(availability.edits.size).toBe(0);
  expect(availability.unavailable.size).toBe(0);
});

test('keeps non-overlapping edits active next to conflicting ones', () => {
  const source = 'aaaa bbbb cccc dddd';
  const value = review({
    edits: [
      { id: '22222222-2222-4222-8222-222222222222', before: source.slice(0, 9), after: 'A', anchor: anchorOn(source, 0, 9) },
      { id: '33333333-3333-4333-8333-333333333333', before: source.slice(5, 14), after: 'B', anchor: anchorOn(source, 5, 14) },
      { id: '44444444-4444-4444-8444-444444444444', before: 'dddd', after: 'D', anchor: anchorOn(source, 15, 19) },
    ],
  });
  const availability = classifyReview(new TextEncoder().encode(source), value);
  expect(availability.conflicting).toEqual(new Set([
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ]));
  expect(availability.edits.get('44444444-4444-4444-8444-444444444444')).toEqual({ from: 15, to: 19 });
});

test('signals may intersect each other and stay active', () => {
  const value = review({
    signals: [
      { id: '33333333-3333-4333-8333-333333333333', type: 'note', selected_text: SOURCE.slice(0, 9), anchor: anchorOn(SOURCE, 0, 9), comment: '' },
      { id: '44444444-4444-4444-8444-444444444444', type: 'warning', selected_text: SOURCE.slice(4, 15), anchor: anchorOn(SOURCE, 4, 15), comment: '' },
    ],
  });
  const availability = classifyReview(new TextEncoder().encode(SOURCE), value);
  expect(availability.conflicting.size).toBe(0);
  expect(availability.signals.get('33333333-3333-4333-8333-333333333333')).toEqual({ from: 0, to: 9 });
  expect(availability.signals.get('44444444-4444-4444-8444-444444444444')).toEqual({ from: 4, to: 15 });
});

test('a stale edit and an active edit are classified independently', () => {
  const value = review({
    edits: [
      { id: '22222222-2222-4222-8222-222222222222', before: 'four', after: 'четыре', anchor: anchorOn(SOURCE, 14, 18) },
      { id: '33333333-3333-4333-8333-333333333333', before: 'пропало', after: 'x', anchor: anchorOn('пропало тут', 0, 14) },
    ],
  });
  const changed = new TextEncoder().encode('one two three x four five');
  const availability = classifyReview(changed, value);
  expect(availability.edits.get('22222222-2222-4222-8222-222222222222')).toEqual({ from: 16, to: 20 });
  expect(availability.unavailable.get('33333333-3333-4333-8333-333333333333')).toEqual({ kind: 'stale' });
  expect(availability.conflicting.size).toBe(0);
});

test('records with unsafe offsets are unavailable on a matching source', () => {
  const anchor = anchorOn(SOURCE, 4, 7);
  const broken = {
    ...anchor,
    start_byte: 9007199254740993,
    end_byte: 9007199254740997,
  };
  const value = review({
    edits: [{ id: '22222222-2222-4222-8222-222222222222', before: 'two', after: 'два', anchor: broken }],
  });
  const availability = classifyReview(new TextEncoder().encode(SOURCE), value);
  expect(availability.edits.size).toBe(0);
  expect(availability.unavailable.get('22222222-2222-4222-8222-222222222222')).toEqual({ kind: 'stale' });
});

test('an empty source leaves every record unavailable', () => {
  const value = review({
    edits: [{ id: '22222222-2222-4222-8222-222222222222', before: 'two', after: 'два', anchor: anchorOn(SOURCE, 4, 7) }],
    signals: [{ id: '33333333-3333-4333-8333-333333333333', type: 'note', selected_text: 'four', anchor: anchorOn(SOURCE, 14, 18), comment: '' }],
  });
  const availability = classifyReview(new TextEncoder().encode(''), value);
  expect(availability.edits.size).toBe(0);
  expect(availability.signals.size).toBe(0);
  expect(availability.unavailable.size).toBe(2);
  expect(availability.conflicting.size).toBe(0);
});

test('an empty review yields empty availability', () => {
  const availability = classifyReview(new TextEncoder().encode(SOURCE), review());
  expect(availability.edits.size).toBe(0);
  expect(availability.signals.size).toBe(0);
  expect(availability.unavailable.size).toBe(0);
  expect(availability.conflicting.size).toBe(0);
});
