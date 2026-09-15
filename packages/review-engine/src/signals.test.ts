import { expect, test } from 'vitest';
import { makeAnchor } from '@galley-desk/pocket-format';
import type { Review, SignalType } from '@galley-desk/pocket-format';
import { addSignal, changeText, openChapter, removeRecord, setChapterNote } from './index';

function review(): Review {
  return {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[]};
}

function id(n: number): string {
  return `${`3333333${n}`.slice(0, 8)}-3333-4333-8333-333333333333`;
}

test('signal in inserted text uses source selection', () => {
  const source = new TextEncoder().encode('кот');
  const review: Review = {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[]};
  const changed = changeText(openChapter(source, review), [{from:3,to:3,insert:' спит'}],
    {anchor:8,head:8}, () => '22222222-2222-4222-8222-222222222222');
  const marked = addSignal(changed, 4, 8, 'note', 'проверить',
    '33333333-3333-4333-8333-333333333333');
  expect(marked.review.signals[0]!.selected_text).toBe(marked.review.edits[0]!.before);
  expect(marked.review.signals[0]!.anchor).toEqual(marked.review.edits[0]!.anchor);
});

test('rejecting an edit keeps its signal', () => {
  const source = new TextEncoder().encode('кот');
  const edited = changeText(openChapter(source, review()), [{from:1,to:2,insert:'и'}],
    {anchor:2,head:2}, () => id(1));
  const marked = addSignal(edited, 0, 3, 'note', 'спорное место', id(9));
  const rejected = removeRecord(marked, id(1));
  expect(rejected.review.edits).toEqual([]);
  expect(rejected.review.signals).toEqual(marked.review.signals);
  expect(rejected.text).toBe('кот');
  expect(rejected.source).toEqual(source);
});

test('removeRecord removes only the record with the given id', () => {
  const source = new TextEncoder().encode('кот');
  const once = changeText(openChapter(source, review()), [{from:1,to:2,insert:'и'}],
    {anchor:2,head:2}, () => id(1));
  const twice = changeText(once, [{from:3,to:3,insert:'а'}], {anchor:4,head:4}, () => id(2));
  const marked = addSignal(twice, 0, 1, 'review', '', id(9));
  const withoutSignal = removeRecord(marked, id(9));
  expect(withoutSignal.review.signals).toEqual([]);
  expect(withoutSignal.review.edits).toEqual(marked.review.edits);
  const unknown = removeRecord(withoutSignal, 'нет такой записи');
  expect(unknown.review.edits).toEqual(withoutSignal.review.edits);
  expect(unknown.review.signals).toEqual(withoutSignal.review.signals);
  expect(unknown.text).toBe(withoutSignal.text);
});

test('setChapterNote changes only the chapter note', () => {
  const source = new TextEncoder().encode('кот');
  const edited = changeText(openChapter(source, review()), [{from:1,to:2,insert:'и'}],
    {anchor:2,head:2}, () => id(1));
  const marked = addSignal(edited, 0, 3, 'warning', '', id(9));
  const noted = setChapterNote(marked, 'вернуться к главе');
  expect(noted.review.chapter_note).toBe('вернуться к главе');
  expect(noted.review.edits).toEqual(marked.review.edits);
  expect(noted.review.signals).toEqual(marked.review.signals);
  expect(noted.source).toEqual(marked.source);
  expect(noted.text).toBe(marked.text);
  expect(noted.selection).toEqual(marked.selection);
});

test('all four signal types accept an empty optional comment', () => {
  const source = new TextEncoder().encode('кот');
  let model = openChapter(source, review());
  const types: SignalType[] = ['note', 'change_required', 'warning', 'review'];
  types.forEach((type, index) => {
    model = addSignal(model, 0, 3, type, index === 3 ? '' : `комментарий ${index + 1}`, id(index + 1));
  });
  expect(model.review.signals.map((signal) => signal.id)).toEqual([id(1), id(2), id(3), id(4)]);
  expect(model.review.signals.map((signal) => signal.type)).toEqual(types);
  expect(model.review.signals.map((signal) => signal.comment))
    .toEqual(['комментарий 1', 'комментарий 2', 'комментарий 3', '']);
  expect(model.review.signals.every((signal) => signal.selected_text === 'кот')).toBe(true);
  expect(model.text).toBe('кот');
});

test('changing type or comment of an existing uuid replaces that record', () => {
  const source = new TextEncoder().encode('кот');
  const marked = addSignal(openChapter(source, review()), 0, 3, 'note', 'первый вариант', id(9));
  const stripped = removeRecord(marked, id(9));
  expect(stripped.review.signals).toEqual([]);
  const retyped = addSignal(stripped, 0, 3, 'warning', 'другой комментарий', id(9));
  expect(retyped.review.signals).toEqual([
    {
      id: id(9),
      type: 'warning',
      selected_text: 'кот',
      anchor: makeAnchor(source, { from: 0, to: 6 }),
      comment: 'другой комментарий',
    },
  ]);
  expect(retyped.review.edits).toEqual([]);
});

test('a signal over edited text keeps original bytes, selection, and never blocks edits', () => {
  const source = new TextEncoder().encode('кот');
  const edited = changeText(openChapter(source, review()), [{from:1,to:2,insert:'XY'}],
    {anchor:2,head:2}, () => id(1));
  expect(edited.text).toBe('кXYт');
  const marked = addSignal(edited, 0, 4, 'review', 'вся строка', id(9));
  expect(marked.review.signals).toEqual([
    {
      id: id(9),
      type: 'review',
      selected_text: 'кот',
      anchor: makeAnchor(source, { from: 0, to: 6 }),
      comment: 'вся строка',
    },
  ]);
  expect(marked.selection).toEqual(edited.selection);
  const merged = changeText(marked, [{from:3,to:3,insert:'Z'}], {anchor:4,head:4},
    () => { throw new Error('must reuse the edit id, signals never merge'); });
  expect(merged.text).toBe('кXYZт');
  expect(merged.review.edits).toHaveLength(1);
  expect(merged.review.edits[0]!.id).toBe(id(1));
  expect(merged.review.signals).toEqual(marked.review.signals);
});
