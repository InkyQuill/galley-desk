import type { RecordView } from '../../shared/api';

const visualCache = new WeakMap<RecordView, RecordView>();

/** Presentation only: storage anchors include unchanged support characters. */
export function visualRecord(record: RecordView): RecordView {
  if (record.kind !== 'edit' || record.from === null || record.to === null) return record;
  const cached = visualCache.get(record);
  if (cached) return cached;
  const before = Array.from(record.before.replace(/\r\n?/g, '\n'));
  const after = Array.from(record.after.replace(/\r\n?/g, '\n'));
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const from = Math.min(record.to, record.from + after.slice(0, prefix).join('').length);
  const result = { ...record, from, to: Math.max(from, record.to - after.slice(after.length - suffix).join('').length),
    before: before.slice(prefix, before.length - suffix).join(''), after: after.slice(prefix, after.length - suffix).join('') };
  visualCache.set(record, result);
  return result;
}

export function recordsInReadingOrder(records: RecordView[]): RecordView[] {
  const position = (record: RecordView) => record.status === 'active' && record.from !== null ? record.from : Infinity;
  return [...records].sort((a, b) => position(a) - position(b));
}
