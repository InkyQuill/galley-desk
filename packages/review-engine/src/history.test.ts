import { expect, test } from 'vitest';
import type { Review } from '@galley-desk/pocket-format';
import { InputHistory, changeText, openChapter } from './index';

function review(): Review {
  return {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[]};
}

function id(n: number): string {
  return `${`2222222${n}`.slice(0, 8)}-1111-4111-8111-111111111111`;
}

test('consecutive input in one group undoes as a single step', () => {
  const source = new TextEncoder().encode('кот');
  const before = openChapter(source, review());
  const one = changeText(before, [{from:3,to:3,insert:'X'}], {anchor:4,head:4}, () => id(1));
  const two = changeText(one, [{from:4,to:4,insert:'Y'}], {anchor:5,head:5}, () => id(2));
  const history = new InputHistory();
  history.push(before, one, 'input');
  history.push(one, two, 'input');
  const undone = history.undo(two);
  expect(undone.text).toBe(before.text);
  expect(undone.review.edits).toEqual([]);
  expect(undone.selection).toEqual(before.selection);
  const redone = history.redo(undone);
  expect(redone.text).toBe(two.text);
  expect(redone.review.edits).toEqual(two.review.edits);
  expect(redone.selection).toEqual(two.selection);
});

test('a selection change breaks the group: undo returns the uuid and cursor of the step', () => {
  const source = new TextEncoder().encode('кот');
  const before = openChapter(source, review());
  const one = changeText(before, [{from:3,to:3,insert:'X'}], {anchor:4,head:4}, () => id(1));
  const two = changeText(one, [{from:4,to:4,insert:'Y'}], {anchor:5,head:5}, () => id(2));
  const history = new InputHistory();
  history.push(before, one, 'input');
  history.push(one, two, 'input:selection-moved');
  const first = history.undo(two);
  expect(first.text).toBe(one.text);
  expect(first.selection).toEqual(one.selection);
  expect(first.review.edits).toEqual([one.review.edits[0]]);
  expect(first.review.edits[0]!.id).toBe(id(1));
  const initial = history.undo(first);
  expect(initial.text).toBe(before.text);
  expect(initial.selection).toEqual(before.selection);
  expect(history.undo(initial)).toBe(initial);
});

test('new input after undo clears redo', () => {
  const source = new TextEncoder().encode('кот');
  const before = openChapter(source, review());
  const one = changeText(before, [{from:3,to:3,insert:'X'}], {anchor:4,head:4}, () => id(1));
  const history = new InputHistory();
  history.push(before, one, 'input');
  const undone = history.undo(one);
  expect(undone.text).toBe('кот');
  const again = changeText(before, [{from:0,to:0,insert:'Z'}], {anchor:1,head:1}, () => id(2));
  history.push(undone, again, 'input');
  expect(history.redo(again)).toBe(again);
  const backToBaseline = history.undo(again);
  expect(backToBaseline.text).toBe('кот');
  expect(backToBaseline.selection).toEqual(undone.selection);
});

test('closing a chapter clears both stacks', () => {
  const source = new TextEncoder().encode('кот');
  const before = openChapter(source, review());
  const one = changeText(before, [{from:3,to:3,insert:'X'}], {anchor:4,head:4}, () => id(1));
  const two = changeText(one, [{from:4,to:4,insert:'Y'}], {anchor:5,head:5}, () => id(2));
  const history = new InputHistory();
  history.push(before, one, 'input');
  history.push(one, two, 'input:selection-moved');
  history.undo(two);
  history.clear();
  expect(history.undo(two)).toBe(two);
  expect(history.redo(two)).toBe(two);
});

test('a restored draft starts with an empty in-memory history', () => {
  const history = new InputHistory();
  const draft = openChapter(new TextEncoder().encode('кот'), review());
  expect(history.undo(draft)).toBe(draft);
  expect(history.redo(draft)).toBe(draft);
});
