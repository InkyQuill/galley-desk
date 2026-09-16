import { expect, test } from 'vitest';
import { makeAnchor } from '@galley-desk/pocket-format';
import type { Review } from '@galley-desk/pocket-format';
import { applyEdit, changeText, InputHistory, openChapter } from './index';

const encoder = new TextEncoder();
const priorId = '22222222-2222-4222-8222-222222222222';

function deletedChapter(text: string, ranges: [number, number][]) {
  const source = encoder.encode(text);
  const review: Review = {
    schema_version: 1,
    chapter_id: '11111111-1111-4111-8111-111111111111',
    source_path: '01.md', chapter_note: '', signals: [],
    edits: ranges.map(([from, to], index) => ({
      id: index === 0 ? priorId : '33333333-3333-4333-8333-333333333333',
      before: text.slice(from, to), after: '',
      anchor: makeAnchor(source, {
        from: encoder.encode(text.slice(0, from)).length,
        to: encoder.encode(text.slice(0, to)).length,
      }),
    })),
  };
  return openChapter(source, review);
}

const cases: {
  name: string; source: string; ranges: [number, number][]; initial: string;
  from: number; to: number; before: string; expected: string;
}[] = [
  { name: 'Pocket blockquote marker at EOF', source: '> Удалённая цитата 😀', ranges: [[1, 21]], initial: '>', from: 0, to: 1, before: '> Удалённая цитата 😀', expected: '' },
  { name: 'paragraph spanning a prior deletion', source: 'До\n\nНачало тайна конец\n\nПосле', ranges: [[11, 16]], initial: 'До\n\nНачало  конец\n\nПосле', from: 4, to: 17, before: 'Начало тайна конец', expected: 'До\n\n\n\nПосле' },
  { name: 'deletion at right boundary', source: 'aXb', ranges: [[1, 2]], initial: 'ab', from: 0, to: 1, before: 'aX', expected: 'b' },
  { name: 'deletion at left boundary', source: 'aXb', ranges: [[1, 2]], initial: 'ab', from: 1, to: 2, before: 'Xb', expected: 'a' },
  { name: 'deletion at BOF', source: 'Xa', ranges: [[0, 1]], initial: 'a', from: 0, to: 1, before: 'Xa', expected: '' },
  { name: 'adjacent deletions at right boundary', source: 'aXYb', ranges: [[1, 2], [2, 3]], initial: 'ab', from: 0, to: 1, before: 'aXY', expected: 'b' },
  { name: 'adjacent deletions at EOF', source: 'aXY', ranges: [[1, 2], [2, 3]], initial: 'a', from: 0, to: 1, before: 'aXY', expected: '' },
  { name: 'adjacent deletions at BOF', source: 'XYa', ranges: [[0, 1], [1, 2]], initial: 'a', from: 0, to: 1, before: 'XYa', expected: '' },
  { name: 'deletions at both boundaries', source: 'aXbYc', ranges: [[1, 2], [3, 4]], initial: 'abc', from: 1, to: 2, before: 'XbY', expected: 'ac' },
  { name: 'UTF-8 and astral boundaries', source: 'я😀秘密б', ranges: [[3, 5]], initial: 'я😀б', from: 1, to: 3, before: '😀秘密', expected: 'яб' },
  { name: 'CRLF source boundary', source: '> цитата\r\nДалее', ranges: [[1, 8]], initial: '>\nДалее', from: 0, to: 1, before: '> цитата', expected: '\nДалее' },
];

test.each(cases)('$name retains deleted source coverage', ({ source, ranges, initial, from, to, before, expected }) => {
  const model = deletedChapter(source, ranges);
  expect(model.text).toBe(initial);
  const changed = changeText(model, [{ from, to, insert: '' }], { anchor: from, head: from },
    () => { throw new Error('must reuse the leftmost absorbed deletion identity'); });
  expect(changed.text).toBe(expected);
  const sourceFrom = encoder.encode(source.slice(0, source.indexOf(before))).length;
  expect(changed.review.edits).toEqual([{
    id: priorId, before, after: '',
    anchor: makeAnchor(model.source, { from: sourceFrom, to: sourceFrom + encoder.encode(before).length }),
  }]);
  expect(changed.source).toEqual(encoder.encode(source));
  expect(openChapter(changed.source, JSON.parse(JSON.stringify(changed.review))).text).toBe(expected);
  const applied = applyEdit(changed, priorId);
  expect(applied.text).toBe(expected);
  expect(applied.source).toEqual(encoder.encode(expected.replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n')));
  expect(applied.review.edits).toEqual([]);
});

test('inserting at a prior deletion keeps it deleted in the stored replacement and apply result', () => {
  const model = deletedChapter('aXYb', [[1, 2], [2, 3]]);
  const changed = changeText(model, [{ from: 1, to: 1, insert: '!' }], { anchor: 2, head: 2 }, () => 'unused');
  expect(changed.text).toBe('a!b');
  expect(changed.review.edits).toEqual([{
    id: priorId, before: 'aXY', after: 'a!', anchor: makeAnchor(model.source, { from: 0, to: 3 }),
  }]);
  expect(applyEdit(changed, priorId).source).toEqual(encoder.encode('a!b'));
});

test('undo restores the exact Pocket deletion and redo restores its composed replacement', () => {
  const model = deletedChapter('> цитата', [[1, 8]]);
  const changed = changeText(model, [{ from: 0, to: 1, insert: '' }], { anchor: 0, head: 0 }, () => 'unused');
  const history = new InputHistory();
  history.push(model, changed, 'remove-marker');
  const undone = history.undo(changed);
  expect(undone).toEqual(model);
  expect(undone.text).toBe('>');
  expect(undone.review.edits[0]?.before).toBe(' цитата');
  const redone = history.redo(undone);
  expect(redone).toEqual(changed);
  expect(redone.text).toBe('');
  expect(redone.review.edits[0]).toMatchObject({ id: priorId, before: '> цитата', after: '' });
});

test('composition beside an active correction preserves its identity and anchor without conflicts', () => {
  const deleted = deletedChapter('aXbc', [[1, 2]]);
  const neighbor = {
    id: '44444444-4444-4444-8444-444444444444', before: 'b', after: 'B',
    anchor: makeAnchor(deleted.source, { from: 2, to: 3 }),
  };
  const model = openChapter(deleted.source, { ...deleted.review, edits: [...deleted.review.edits, neighbor] });
  expect(model.text).toBe('aBc');
  const changed = changeText(model, [{ from: 0, to: 1, insert: '' }], { anchor: 0, head: 0 }, () => 'unused');
  expect(changed.text).toBe('Bc');
  expect(changed.review.edits).toEqual([neighbor, {
    id: priorId, before: 'aX', after: '', anchor: makeAnchor(model.source, { from: 0, to: 2 }),
  }]);
  const appliedDeletion = applyEdit(changed, priorId);
  expect(appliedDeletion.source).toEqual(encoder.encode('bc'));
  expect(appliedDeletion.text).toBe('Bc');
  const appliedBoth = applyEdit(appliedDeletion, neighbor.id);
  expect(appliedBoth.source).toEqual(encoder.encode('Bc'));
  expect(appliedBoth.review.edits).toEqual([]);
});
