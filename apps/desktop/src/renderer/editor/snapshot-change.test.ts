import { EditorSelection, Text } from '@codemirror/state';
import { expect, test } from 'vitest';
import { snapshotChange } from './snapshot-change';

test('snapshot deletion maps the reading selection to the same surviving words', () => {
  const before = 'First paragraph\n\nRemove this paragraph\n\nReading here\n\nLast paragraph';
  const after = before.replace('Remove this paragraph\n\n', '');
  const changes = snapshotChange(before, after);
  const range = EditorSelection.single(before.indexOf('Reading'), before.indexOf('here') + 4).map(changes, -1);
  expect(changes.apply(Text.of(before.split('\n'))).toString()).toBe(after);
  expect(after.slice(range.main.from, range.main.to)).toBe('Reading here');
  expect(changes.mapPos(before.indexOf('Last'))).toBe(after.indexOf('Last'));
});

test('undo insertion keeps a collapsed caret on its starting side', () => {
  const before = 'До\n\nПосле';
  const after = 'До\n\nВозвращённый абзац 🐈\n\nПосле';
  const changes = snapshotChange(before, after);
  expect(EditorSelection.single(4).map(changes, -1).main.anchor).toBe(4);
  expect(changes.apply(Text.of(before.split('\n'))).toString()).toBe(after);
});

test('empty and astral-character snapshots produce the exact authoritative text', () => {
  for (const [before, after] of [['', '🐈'], ['🐈', ''], ['🐈 кот', '🐕 кот'], ['same', 'same']]) {
    expect(snapshotChange(before!, after!).apply(Text.of(before!.split('\n'))).toString()).toBe(after);
  }
});
