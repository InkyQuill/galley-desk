import { EditorState } from '@codemirror/state';
import { expect, test } from 'vitest';
import type { RecordView } from '../../shared/api';
import { buildDecorations, mappedRecords, setRecordMarkers } from './markers';

function record(id: string, from: number, to: number): RecordView {
  return { id, from, to, kind: 'edit', status: 'active', reason: '', before: 'before', after: 'after', comment: '', signalType: null };
}

test('pending typing maps gutter and preview anchors together, including zero-length deletion', () => {
  let state = EditorState.create({ doc: 'one two three', extensions: [mappedRecords] });
  state = state.update({ effects: setRecordMarkers.of([record('edit', 4, 7), { ...record('deleted', 8, 8), after: '' }]) }).state;
  state = state.update({ changes: { from: 0, insert: '**intro**\n' } }).state;
  expect(state.field(mappedRecords).map(({ id, from, to }) => ({ id, from, to }))).toEqual([
    { id: 'edit', from: 14, to: 17 }, { id: 'deleted', from: 18, to: 18 },
  ]);
  state = state.update({ changes: { from: 15, insert: 'ABC' } }).state;
  expect(state.field(mappedRecords).map(({ from, to }) => [from, to])).toEqual([[14, 20], [21, 21]]);
});

test('unavailable/conflicting anchors never receive gutter targets even with non-null coordinates', () => {
  let state = EditorState.create({ doc: 'one two', extensions: [mappedRecords] });
  state = state.update({ effects: setRecordMarkers.of([
    record('active', 0, 3), { ...record('conflict', 0, 3), status: 'conflicting' },
    { ...record('stale', 4, 7), status: 'unavailable' }, record('invalid', 5, 50),
  ]) }).state;
  expect(state.field(mappedRecords).map((item) => item.id)).toEqual(['active']);
});

test('comments and deletion placeholders decorate without changing manuscript coordinates', () => {
  const doc = EditorState.create({ doc: 'one two' }).doc;
  const decorations = buildDecorations([
    record('edit', 0, 3), { ...record('delete', 4, 4), after: '' },
    { ...record('signal', 4, 7), kind: 'signal', signalType: 'note', comment: 'private note' },
  ], doc);
  const ranges: { from: number; to: number; widget: unknown }[] = [];
  decorations.between(0, doc.length, (from, to, value) => { ranges.push({ from, to, widget: value.spec.widget }); });
  expect(ranges.map(({ from, to, widget }) => ({ from, to, widget: widget !== undefined }))).toEqual([
    { from: 0, to: 3, widget: false }, { from: 4, to: 4, widget: true },
    { from: 4, to: 7, widget: false }, { from: 7, to: 7, widget: true },
  ]);
  expect(doc.toString()).toBe('one two');
});
