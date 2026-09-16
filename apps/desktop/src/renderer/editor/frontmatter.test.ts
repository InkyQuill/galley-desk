import { expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { protectedFrontmatter } from './frontmatter';
import { fromSnapshot } from './transaction-adapter';
const prefix = '---\ntitle: 🐈\n---\n';
const state = () =>
  EditorState.create({
    doc: prefix + 'body',
    extensions: protectedFrontmatter(),
  });
test('select-all delete, crossing paste and start-of-body Backspace cannot remove hidden metadata', () => {
  for (const change of [
    { from: 0, to: prefix.length + 4, insert: '' },
    { from: prefix.length - 1, to: prefix.length, insert: '' },
    { from: 2, to: prefix.length + 2, insert: 'paste' },
  ])
    expect(state().update({ changes: change }).newDoc.toString()).toBe(
      prefix + 'body',
    );
});
test('body typing and selection retain absolute coordinates; snapshot changes remain authorized', () => {
  const changed = state().update({
    changes: { from: prefix.length, insert: 'A' },
  });
  expect(changed.newDoc.toString()).toBe(prefix + 'Abody');
  expect(
    state().update({ selection: { anchor: 0 } }).newSelection.main.anchor,
  ).toBe(prefix.length);
  expect(
    state()
      .update({
        changes: { from: 0, to: prefix.length, insert: '' },
        annotations: fromSnapshot.of(true),
      })
      .newDoc.toString(),
  ).toBe('body');
});

test('cached boundary refreshes after metadata replacement and allows newly exposed body', () => {
  let current = state();
  const longer = '---\ntitle: A longer title\n---\n';
  current = current.update({ changes: { from: 0, to: prefix.length, insert: longer }, annotations: fromSnapshot.of(true) }).state;
  expect(current.update({ changes: { from: prefix.length, insert: 'bad' } }).newDoc.toString()).toBe(longer + 'body');
  current = current.update({ changes: { from: 0, to: longer.length, insert: '' }, annotations: fromSnapshot.of(true) }).state;
  expect(current.update({ changes: { from: 0, insert: 'A' } }).newDoc.toString()).toBe('Abody');
});

test('unterminated metadata still hides an appended suffix until repaired', () => {
  let current = EditorState.create({ doc: '---\ntitle: unfinished', extensions: protectedFrontmatter() });
  current = current.update({ changes: { from: current.doc.length, insert: '\nmore' } }).state;
  expect(current.update({ selection: { anchor: current.doc.length - 2 } }).newSelection.main.anchor).toBe(current.doc.length);
});
