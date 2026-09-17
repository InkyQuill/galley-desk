// Literal search over the derived chapter text: exact UTF-16 code-unit
// matching via indexOf — no regex, no case folding, no replace. Positions use
// the same UTF-16 coordinates as RecordView.from/to and the editor document,
// so results map onto views without re-encoding.
// Комментарии и заметка главы в поиск не входят: поиск работает только по
// snapshot.text (виды «Текст» и «Сравнение») или snapshot.sourceText
// («Исходник») — этот выбор делает ChapterSearch, не эта функция.

export type SearchRange = { from: number; to: number };

export function findLiteral(text: string, query: string): SearchRange[] {
  const result: SearchRange[] = [];
  if (!query) return result;
  for (let from = text.indexOf(query); from >= 0; from = text.indexOf(query, from + query.length)) {
    result.push({ from, to: from + query.length });
  }
  return result;
}

/**
 * Явные координаты сегментов «Сравнения» (ComparisonView): производный текст
 * нарезан на неизменённые куски (display == derived) и заменяющие куски правок
 * (показывается before + after, поэтому введённая часть сдвинута на длину
 * before). Эти координаты строит ComparisonView — поиск не повторяет геометрию.
 */
export type ComparisonSegment =
  | { kind: 'text'; derivedFrom: number; derivedTo: number; displayStart: number }
  | { kind: 'edit'; derivedFrom: number; derivedTo: number; displayStart: number; beforeLength: number };

/** display-смещение точки производного текста; конец документа → конец display. */
function displayOffsetOf(segments: readonly ComparisonSegment[], derived: number): number | null {
  if (segments.length === 0) return derived === 0 ? 0 : null;
  for (const segment of segments) {
    if (derived >= segment.derivedFrom && derived < segment.derivedTo) {
      const offset = derived - segment.derivedFrom;
      return segment.kind === 'text'
        ? segment.displayStart + offset
        : segment.displayStart + segment.beforeLength + offset;
    }
  }
  const last = segments[segments.length - 1];
  if (last === undefined || derived !== last.derivedTo) return null;
  const length = last.derivedTo - last.derivedFrom;
  return last.kind === 'text' ? last.displayStart + length : last.displayStart + last.beforeLength + length;
}

/**
 * Переводит диапазон находки из производных координат (snapshot.text) в
 * display-координаты «Сравнения». Диапазон вне документа даёт null.
 * Пустой документ имеет единственную точку 0.
 */
export function derivedRangeToDisplayRange(
  segments: readonly ComparisonSegment[],
  from: number,
  to: number,
): SearchRange | null {
  const displayFrom = displayOffsetOf(segments, from);
  if (displayFrom === null) return null;
  const displayTo = to <= from ? displayFrom : displayOffsetOf(segments, to);
  if (displayTo === null) return null;
  return { from: displayFrom, to: displayTo };
}
