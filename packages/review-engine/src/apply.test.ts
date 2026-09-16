import { expect, test } from 'vitest';
import { makeAnchor } from '@galley-desk/pocket-format';
import type { Edit, Review, Signal } from '@galley-desk/pocket-format';
import { applyEdit, openChapter } from './index';

const CHAPTER_ID = '11111111-1111-4111-8111-111111111111';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';

function reviewWith(source: Uint8Array, edits: Edit[], signals: Signal[] = []): Review {
  return {
    schema_version: 1,
    chapter_id: CHAPTER_ID,
    source_path: '01.md',
    chapter_note: '',
    signals,
    edits,
  };
}

function signalOn(source: Uint8Array, id: string, from: number, to: number, comment = ''): Signal {
  return { id, type: 'review', comment, selected_text: new TextDecoder().decode(source.subarray(from, to)), anchor: makeAnchor(source, { from, to }) };
}

test('apply shifts an adjacent correction exactly', () => {
  const source = new TextEncoder().encode('abcd');
  const edits = [
    {id:'22222222-2222-4222-8222-222222222222',before:'ab',after:'X',anchor:makeAnchor(source,{from:0,to:2})},
    {id:'33333333-3333-4333-8333-333333333333',before:'cd',after:'Y',anchor:makeAnchor(source,{from:2,to:4})}
  ];
  const review: Review = {schema_version:1,chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md',chapter_note:'',signals:[],edits};
  const next = applyEdit(openChapter(source,review), edits[0]!.id);
  expect(new TextDecoder().decode(next.source)).toBe('Xcd');
  expect(next.review.edits[0]!.anchor.start_byte).toBe(1);
  expect(next.text).toBe('XY');
});

test('apply demands an active edit id', () => {
  const source = new TextEncoder().encode('abcd');
  const stale = { id: 'stale', before: 'zz', after: 'q', anchor: makeAnchor(source, { from: 0, to: 2 }) };
  const first = { id: 'c1', before: 'ab', after: 'X', anchor: makeAnchor(source, { from: 0, to: 2 }) };
  const second = { id: 'c2', before: 'bc', after: 'Y', anchor: makeAnchor(source, { from: 1, to: 3 }) };
  const model = openChapter(source, reviewWith(source, [stale, first, second]));
  expect(() => applyEdit(model, 'missing')).toThrowError(/not active/);
  expect(() => applyEdit(model, 'stale')).toThrowError(/not active/);
  expect(() => applyEdit(model, 'c1')).toThrowError(/not active/);
  expect(() => applyEdit(model, 'c2')).toThrowError(/not active/);
});

test('a stale record overlapping the applied offsets keeps its anchor untouched', () => {
  const source = new TextEncoder().encode('abcd');
  const stale = { id: 'stale', before: 'zz', after: 'q', anchor: makeAnchor(source, { from: 2, to: 4 }) };
  const edit = { id: E1, before: 'ab', after: 'X', anchor: makeAnchor(source, { from: 0, to: 2 }) };
  const next = applyEdit(openChapter(source, reviewWith(source, [edit, stale])), E1);
  expect(next.review.edits).toContainEqual(stale);
});

test('conflicting corrections stay in the review with their original anchors', () => {
  const source = new TextEncoder().encode('abcdef');
  const first = { id: 'c1', before: 'bc', after: 'X', anchor: makeAnchor(source, { from: 1, to: 3 }) };
  const second = { id: 'c2', before: 'cd', after: 'Y', anchor: makeAnchor(source, { from: 2, to: 4 }) };
  const applied = { id: E1, before: 'ef', after: 'Z', anchor: makeAnchor(source, { from: 4, to: 6 }) };
  const next = applyEdit(openChapter(source, reviewWith(source, [applied, first, second])), E1);
  expect(new TextDecoder().decode(next.source)).toBe('abcdZ');
  expect(next.review.edits).toContainEqual(first);
  expect(next.review.edits).toContainEqual(second);
});

test('signals outside the replacement get fresh anchors at their exact ranges', () => {
  const source = new TextEncoder().encode('abcd');
  const edit = { id: E1, before: 'bc', after: 'XYZ', anchor: makeAnchor(source, { from: 1, to: 3 }) };
  const beforeSignal = signalOn(source, 's-before', 0, 1);
  const afterSignal = signalOn(source, 's-after', 3, 4);
  const next = applyEdit(openChapter(source, reviewWith(source, [edit], [beforeSignal, afterSignal])), E1);
  expect(next.source).toEqual(new TextEncoder().encode('aXYZd'));
  expect(next.review.signals).toHaveLength(2);
  const kept = next.review.signals.find((signal) => signal.id === 's-before') as Signal;
  expect(kept.anchor).toEqual(makeAnchor(next.source, { from: 0, to: 1 }));
  expect(kept.selected_text).toBe('a');
  const shifted = next.review.signals.find((signal) => signal.id === 's-after') as Signal;
  expect(shifted.anchor).toEqual(makeAnchor(next.source, { from: 4, to: 5 }));
  expect(shifted.selected_text).toBe('d');
  expect(shifted.comment).toBe('');
});

test('apply refreshes a signal before the replacement when its text repeats', () => {
  const source = new TextEncoder().encode('aa bb aa');
  const edit = { id: E1, before: 'bb', after: 'X', anchor: makeAnchor(source, { from: 3, to: 5 }) };
  const signal = signalOn(source, E2, 0, 2, 'first occurrence');
  const next = applyEdit(openChapter(source, reviewWith(source, [edit], [signal])), E1);
  expect(next.review.signals).toEqual([
    { ...signal, anchor: makeAnchor(next.source, { from: 0, to: 2 }) },
  ]);
});

test('a signal spanning the whole replacement keeps covering it over the corrected bytes', () => {
  const source = new TextEncoder().encode('abcd');
  const edit = { id: E1, before: 'bc', after: 'XYZ', anchor: makeAnchor(source, { from: 1, to: 3 }) };
  const spanning = signalOn(source, 's-span', 0, 4, 'whole line');
  const next = applyEdit(openChapter(source, reviewWith(source, [edit], [spanning])), E1);
  expect(next.review.signals).toHaveLength(1);
  const moved = next.review.signals[0] as Signal;
  expect(moved.anchor).toEqual(makeAnchor(next.source, { from: 0, to: 5 }));
  expect(moved.selected_text).toBe('aXYZd');
  expect(moved.comment).toBe('whole line');
});

test('apply keeps an independent signal whose selection disappeared', () => {
  const source = new TextEncoder().encode('кот');
  const edit = { id: E1, before: 'кот', after: 'кит', anchor: makeAnchor(source, { from: 0, to: 6 }) };
  const signal = signalOn(source, E2, 0, 6, 'не терять');
  const next = applyEdit(openChapter(source, reviewWith(source, [edit], [signal])), E1);
  expect(next.review.signals).toEqual([signal]);
});

test('apply refreshes an earlier active anchor even with zero shift', () => {
  const source = new TextEncoder().encode('aa bb');
  const edits = [
    { id: E1, before: 'aa', after: 'X', anchor: makeAnchor(source, { from: 0, to: 2 }) },
    { id: E2, before: 'bb', after: 'aa', anchor: makeAnchor(source, { from: 3, to: 5 }) },
  ];
  const next = applyEdit(openChapter(source, reviewWith(source, edits)), E2);
  expect(next.text).toBe('X aa');
  expect(next.review.edits[0]!.anchor).toEqual(makeAnchor(next.source, { from: 0, to: 2 }));
});

test('a partially overlapping signal keeps its old anchor instead of guessing', () => {
  const source = new TextEncoder().encode('abcd');
  const edit = { id: E1, before: 'bc', after: 'XY', anchor: makeAnchor(source, { from: 1, to: 3 }) };
  const headOverlap = signalOn(source, 's-head', 0, 2);
  const tailOverlap = signalOn(source, 's-tail', 2, 4);
  const next = applyEdit(openChapter(source, reviewWith(source, [edit], [headOverlap, tailOverlap])), E1);
  expect(next.review.signals).toHaveLength(2);
  expect(next.review.signals).toContainEqual(headOverlap);
  expect(next.review.signals).toContainEqual(tailOverlap);
});

test('a shortening replacement shifts later records by the negative byte delta', () => {
  const source = new TextEncoder().encode('абвг');
  const edit = { id: E1, before: 'аб', after: '', anchor: makeAnchor(source, { from: 0, to: 4 }) };
  const next = { id: E2, before: 'вг', after: 'д', anchor: makeAnchor(source, { from: 4, to: 8 }) };
  const applied = applyEdit(openChapter(source, reviewWith(source, [edit, next])), E1);
  expect(new TextDecoder().decode(applied.source)).toBe('вг');
  expect(applied.review.edits).toEqual([
    { id: E2, before: 'вг', after: 'д', anchor: makeAnchor(applied.source, { from: 0, to: 4 }) },
  ]);
  expect(applied.text).toBe('д');
});

test('the applied record is removed so the derived text matches the new source', () => {
  const source = new TextEncoder().encode('abcd');
  const edit = { id: E1, before: 'ab', after: 'X', anchor: makeAnchor(source, { from: 0, to: 2 }) };
  const next = applyEdit(openChapter(source, reviewWith(source, [edit])), E1);
  expect(next.review.edits).toEqual([]);
  expect(next.text).toBe(new TextDecoder().decode(next.source));
  expect(next.source).toEqual(new TextEncoder().encode('Xcd'));
});
