import type { RecordMarker } from '../data/fixtures';

export type MarkedSegment = {
  text: string;
  record: RecordMarker | null;
};

/**
 * Разбивает текст главы на чередующиеся простые и подсвеченные сегменты по
 * непересекающимся диапазонам записей — источник для фоновой заливки правок
 * и сигналов (см. спеку, «Разметка правок и сигналов в редакторе»).
 */
export function markText(text: string, records: RecordMarker[]): MarkedSegment[] {
  const sorted = [...records].sort((a, b) => a.from - b.from);
  const segments: MarkedSegment[] = [];
  let cursor = 0;
  for (const record of sorted) {
    const from = Math.max(cursor, Math.min(record.from, text.length));
    const to = Math.max(from, Math.min(record.to, text.length));
    if (to <= from) continue;
    if (from > cursor) segments.push({ text: text.slice(cursor, from), record: null });
    segments.push({ text: text.slice(from, to), record });
    cursor = to;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), record: null });
  return segments;
}
