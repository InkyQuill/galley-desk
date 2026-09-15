import { expect, test } from 'vitest';
import { makeAnchor } from '@galley-desk/pocket-format';
import type { Review } from '@galley-desk/pocket-format';
import { openChapter, changeText } from './index';

function review(fields?: Partial<Review>): Review {
  return {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[], ...fields};
}

test('editing an existing correction keeps identity', () => {
  const review: Review = {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[]};
  const source = new TextEncoder().encode('кот');
  const first = changeText(openChapter(source, review), [{from:1,to:2,insert:'и'}],
    {anchor:2,head:2}, () => '22222222-2222-4222-8222-222222222222');
  const second = changeText(first, [{from:1,to:2,insert:'а'}], {anchor:2,head:2},
    () => { throw new Error('must reuse id'); });
  expect(second.text).toBe('кат');
  expect(second.review.edits[0]!.id).toBe(first.review.edits[0]!.id);
  expect(second.source).toEqual(source);
});

test('pure insertion at BOF extends right onto the first code point', () => {
  const source = new TextEncoder().encode('кот');
  const model = changeText(openChapter(source, review()), [{ from: 0, to: 0, insert: 'X' }],
    { anchor: 1, head: 1 }, () => '33333333-3333-4333-8333-333333333333');
  expect(model.text).toBe('Xкот');
  expect(model.review.edits).toEqual([
    {
      id: '33333333-3333-4333-8333-333333333333',
      before: 'к',
      after: 'Xк',
      anchor: makeAnchor(source, { from: 0, to: 2 }),
    },
  ]);
});

test('pure insertion at EOF extends left onto the last code point', () => {
  const source = new TextEncoder().encode('кот');
  const model = changeText(openChapter(source, review()), [{ from: 3, to: 3, insert: 'X' }],
    { anchor: 4, head: 4 }, () => '33333333-3333-4333-8333-333333333333');
  expect(model.text).toBe('котX');
  expect(model.review.edits).toEqual([
    {
      id: '33333333-3333-4333-8333-333333333333',
      before: 'т',
      after: 'тX',
      anchor: makeAnchor(source, { from: 4, to: 6 }),
    },
  ]);
});

test('typing after deleting all text merges into the deletion record', () => {
  const source = new TextEncoder().encode('кот');
  const deleted = changeText(openChapter(source, review()), [{ from: 0, to: 3, insert: '' }],
    { anchor: 0, head: 0 }, () => '44444444-4444-4444-8444-444444444444');
  expect(deleted.text).toBe('');
  expect(deleted.review.edits).toEqual([
    { id: '44444444-4444-4444-8444-444444444444', before: 'кот', after: '', anchor: makeAnchor(source, { from: 0, to: 6 }) },
  ]);
  const retyped = changeText(deleted, [{ from: 0, to: 0, insert: 'Да' }], { anchor: 2, head: 2 },
    () => { throw new Error('must reuse id'); });
  expect(retyped.text).toBe('Да');
  expect(retyped.review.edits).toEqual([
    { id: '44444444-4444-4444-8444-444444444444', before: 'кот', after: 'Да', anchor: makeAnchor(source, { from: 0, to: 6 }) },
  ]);
});

test('insertion right after an edit merges into that edit and reuses its id', () => {
  const source = new TextEncoder().encode('кот');
  const edited = changeText(openChapter(source, review()), [{ from: 1, to: 2, insert: 'и' }],
    { anchor: 2, head: 2 }, () => '55555555-5555-4555-8555-555555555555');
  const merged = changeText(edited, [{ from: 2, to: 2, insert: 'X' }], { anchor: 3, head: 3 },
    () => { throw new Error('must reuse id'); });
  expect(merged.text).toBe('киXт');
  expect(merged.review.edits).toEqual([
    { id: '55555555-5555-4555-8555-555555555555', before: 'о', after: 'иX', anchor: makeAnchor(source, { from: 2, to: 4 }) },
  ]);
});

test('insertion before an edit becomes a separate record beside it', () => {
  const source = new TextEncoder().encode('кот');
  const edited = changeText(openChapter(source, review()), [{ from: 1, to: 2, insert: 'и' }],
    { anchor: 2, head: 2 }, () => '55555555-5555-4555-8555-555555555555');
  const beside = changeText(edited, [{ from: 1, to: 1, insert: 'X' }], { anchor: 2, head: 2 },
    () => '66666666-6666-4666-8666-666666666666');
  expect(beside.text).toBe('кXит');
  expect(beside.review.edits).toEqual([
    {
      id: '55555555-5555-4555-8555-555555555555',
      before: 'о',
      after: 'и',
      anchor: makeAnchor(source, { from: 2, to: 4 }),
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      before: 'к',
      after: 'кX',
      anchor: makeAnchor(source, { from: 0, to: 2 }),
    },
  ]);
});

test('one change crossing two edits absorbs both and reuses the leftmost id', () => {
  const source = new TextEncoder().encode('кот');
  const first = changeText(openChapter(source, review()), [{ from: 0, to: 1, insert: 'О' }],
    { anchor: 1, head: 1 }, () => '77777777-7777-4777-8777-777777777777');
  const second = changeText(first, [{ from: 2, to: 3, insert: 'Т' }], { anchor: 3, head: 3 },
    () => '88888888-8888-4888-8888-888888888888');
  expect(second.text).toBe('ОоТ');
  const crossed = changeText(second, [{ from: 0, to: 3, insert: 'ЛИС' }], { anchor: 3, head: 3 },
    () => { throw new Error('must reuse id'); });
  expect(crossed.text).toBe('ЛИС');
  expect(crossed.review.edits).toEqual([
    {
      id: '77777777-7777-4777-8777-777777777777',
      before: 'кот',
      after: 'ЛИС',
      anchor: makeAnchor(source, { from: 0, to: 6 }),
    },
  ]);
});

test('retyping the original text drops the record entirely', () => {
  const source = new TextEncoder().encode('кот');
  const edited = changeText(openChapter(source, review()), [{ from: 1, to: 2, insert: 'и' }],
    { anchor: 2, head: 2 }, () => '99999999-9999-4999-8999-999999999999');
  const restored = changeText(edited, [{ from: 1, to: 2, insert: 'о' }], { anchor: 2, head: 2 },
    () => { throw new Error('must reuse id, not mint'); });
  expect(restored.text).toBe('кот');
  expect(restored.review.edits).toEqual([]);
  expect(restored.source).toEqual(source);
});

test('changes inside an astral symbol are rejected, never cut', () => {
  const source = new TextEncoder().encode('😀к');
  const model = openChapter(source, review());
  expect(() => changeText(model, [{ from: 0, to: 1, insert: '' }], { anchor: 0, head: 0 }, () => 'aaaaaaa1-1111-4111-8111-111111111111'))
    .toThrowError(/surrogate/i);
  expect(() => changeText(model, [{ from: 1, to: 2, insert: 'X' }], { anchor: 1, head: 1 }, () => 'aaaaaaa2-2222-4222-8222-222222222222'))
    .toThrowError(/surrogate/i);
  expect(() => changeText(model, [{ from: 2, to: 3, insert: 'X' }], { anchor: 2, head: 2 }, () => 'aaaaaaa3-3333-4333-8333-333333333333'))
    .not.toThrow();
});

test('insertion after an emoji replaces the whole symbol, not half of it', () => {
  const source = new TextEncoder().encode('😀к');
  const model = changeText(openChapter(source, review()), [{ from: 2, to: 2, insert: 'X' }],
    { anchor: 2, head: 2 }, () => 'bbbbbbb1-1111-4111-8111-111111111111');
  expect(model.text).toBe('😀Xк');
  expect(model.review.edits).toEqual([
    {
      id: 'bbbbbbb1-1111-4111-8111-111111111111',
      before: '😀',
      after: '😀X',
      anchor: makeAnchor(source, { from: 0, to: 4 }),
    },
  ]);
});

test('multi-cursor transaction produces one record spanning both cursors', () => {
  const source = new TextEncoder().encode('котик');
  let idCalls = 0;
  const model = changeText(openChapter(source, review()),
    [{ from: 4, to: 5, insert: 'К' }, { from: 1, to: 2, insert: 'А' }],
    { anchor: 5, head: 5 }, () => { idCalls += 1; return `ccccccc${idCalls}-1111-4111-8111-111111111111`; });
  expect(model.text).toBe('кАтиК');
  expect(idCalls).toBe(1);
  expect(model.review.edits).toEqual([
    {
      id: 'ccccccc1-1111-4111-8111-111111111111',
      before: 'отик',
      after: 'АтиК',
      anchor: makeAnchor(source, { from: 2, to: 10 }),
    },
  ]);
});

test('two multi-cursor insertions extend onto their left neighbors once', () => {
  const source = new TextEncoder().encode('кот');
  const model = changeText(openChapter(source, review()),
    [{ from: 0, to: 0, insert: 'X' }, { from: 2, to: 2, insert: 'Y' }],
    { anchor: 2, head: 2 }, () => 'ddddddd1-1111-4111-8111-111111111111');
  expect(model.text).toBe('XкоYт');
  expect(model.review.edits).toEqual([
    {
      id: 'ddddddd1-1111-4111-8111-111111111111',
      before: 'ко',
      after: 'XкоY',
      anchor: makeAnchor(source, { from: 0, to: 4 }),
    },
  ]);
});

test('multi-paragraph paste stores LF in an LF source', () => {
  const source = new TextEncoder().encode('ab\ncd');
  const model = changeText(openChapter(source, review()), [{ from: 1, to: 3, insert: 'X\nY' }],
    { anchor: 2, head: 2 }, () => 'eeeeeee1-1111-4111-8111-111111111111');
  expect(model.text).toBe('aX\nYcd');
  expect(model.review.edits).toEqual([
    {
      id: 'eeeeeee1-1111-4111-8111-111111111111',
      before: 'b\n',
      after: 'X\nY',
      anchor: makeAnchor(source, { from: 1, to: 3 }),
    },
  ]);
});

test('an empty chapter opens but rejects any text change', () => {
  const model = openChapter(new Uint8Array(0), review());
  expect(model.text).toBe('');
  expect(model.pieces).toEqual([]);
  expect(() => changeText(model, [{ from: 0, to: 0, insert: 'X' }], { anchor: 0, head: 0 }, () => 'f1111111-1111-4111-8111-111111111111'))
    .toThrowError('EMPTY_SOURCE');
});

test('a stale record with the same offsets stays in review and out of the merge', () => {
  const source = new TextEncoder().encode('кот');
  const stale = { id: 'e-stale', before: 'z', after: 'y', anchor: makeAnchor(source, { from: 2, to: 4 }) };
  const edited = openChapter(source, review({ edits: [stale] }));
  const updated = changeText(edited, [{ from: 1, to: 2, insert: 'и' }], { anchor: 2, head: 2 },
    () => 'f2222222-2222-4222-8222-222222222222');
  expect(updated.text).toBe('кит');
  expect(updated.review.edits).toHaveLength(2);
  expect(updated.review.edits).toContainEqual(stale);
  expect(updated.review.edits).toContainEqual({
    id: 'f2222222-2222-4222-8222-222222222222',
    before: 'о',
    after: 'и',
    anchor: makeAnchor(source, { from: 2, to: 4 }),
  });
});

test('new EOLs inside after follow the first EOL style of a CRLF source', () => {
  const source = new TextEncoder().encode('ab\r\ncd');
  const model = changeText(openChapter(source, review()), [{ from: 2, to: 2, insert: 'X\nY' }],
    { anchor: 3, head: 3 }, () => 'eeeeeee2-2222-4222-8222-222222222222');
  expect(model.text).toBe('abX\nY\ncd');
  expect(model.review.edits).toEqual([
    {
      id: 'eeeeeee2-2222-4222-8222-222222222222',
      before: 'b',
      after: 'bX\r\nY',
      anchor: makeAnchor(source, { from: 1, to: 2 }),
    },
  ]);
});

test('unchanged CRLF bytes survive editing byte-exactly', () => {
  const source = new TextEncoder().encode('ab\r\ncd');
  const model = changeText(openChapter(source, review()), [{ from: 0, to: 1, insert: 'A' }],
    { anchor: 1, head: 1 }, () => 'eeeeeee3-3333-4333-8333-333333333333');
  expect(model.source).toEqual(source);
  expect(model.pieces).toEqual([
    { text: 'A', source: { from: 0, to: 1 }, editId: 'eeeeeee3-3333-4333-8333-333333333333' },
    { text: 'b\ncd', source: { from: 1, to: 6 } },
  ]);
});

test('changes bracketing an edit absorb it instead of overlapping its range', () => {
  const source = new TextEncoder().encode('abcdef');
  let model = openChapter(source, review({ edits: [
    { id: 'e1', before: 'b', after: 'B', anchor: makeAnchor(source, { from: 1, to: 2 }) },
    { id: 'e2', before: 'e', after: 'E', anchor: makeAnchor(source, { from: 4, to: 5 }) },
  ] }));
  expect(model.text).toBe('aBcdEf');
  model = changeText(model, [{ from: 0, to: 1, insert: 'X' }, { from: 5, to: 6, insert: 'Y' }],
    { anchor: 2, head: 2 }, () => { throw new Error('must reuse leftmost id'); });
  expect(model.text).toBe('XBcdEY');
  expect(model.review.edits).toEqual([
    {
      id: 'e1',
      before: 'abcdef',
      after: 'XBcdEY',
      anchor: makeAnchor(source, { from: 0, to: 6 }),
    },
  ]);
  expect(model.pieces).toEqual([
    { text: 'XBcdEY', source: { from: 0, to: 6 }, editId: 'e1' },
  ]);
});
