import { expect, test } from 'vitest';
import { visualRecord } from './visual-range';
import type { RecordView } from '../../shared/api';
const edit = (before: string, after: string): RecordView => ({ id: 'a', kind: 'edit', status: 'active', reason: '', from: 10, to: 10 + after.replace(/\r\n?/g, '\n').length, before, after, comment: '', signalType: null });
test.each([
  ['a', 'abc', 11, 13, '', 'bc'], ['a', 'bca', 10, 12, '', 'bc'],
  ['abc', 'a', 11, 11, 'bc', ''], ['abc', 'c', 10, 10, 'ab', ''],
  ['x\r\n😀a!', 'x\n😁b!', 12, 15, '😀a', '😁b'],
])('trims only unchanged support text: %s → %s', (before, after, from, to, removed, inserted) => {
  const original = edit(before as string, after as string);
  expect(visualRecord(original)).toMatchObject({ from, to, before: removed, after: inserted });
  expect(original.before).toBe(before);
});

test('reading order is position based, ties stable and unavailable last', async () => {
  const { recordsInReadingOrder } = await import('./visual-range');
  const a = { ...edit('a', 'b'), id: 'a' };
  const unavailable = { ...a, id: 'missing', status: 'unavailable' as const, from: 0 };
  const early = { ...a, id: 'early', from: 1 };
  const tie = { ...a, id: 'tie' };
  expect(recordsInReadingOrder([unavailable, a, early, tie]).map((record) => record.id)).toEqual(['early', 'a', 'tie', 'missing']);
});
