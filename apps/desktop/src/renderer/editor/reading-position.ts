import { derivedRangeToDisplayRange, type ComparisonSegment } from '../search/search';
import { snapshotChange } from './snapshot-change';

export type ViewportAnchor = { derivedOffset: number; topOffset: number };

/** UTF-16 coordinates; old text collapses to the edit's derived start. */
export function displayOffsetToDerived(segments: readonly ComparisonSegment[], offset: number): number | null {
  if (!Number.isInteger(offset) || offset < 0) return null;
  if (segments.length === 0) return offset === 0 ? 0 : null;
  for (const segment of segments) {
    const before = segment.kind === 'edit' ? segment.beforeLength : 0;
    const end = segment.displayStart + before + segment.derivedTo - segment.derivedFrom;
    if (offset >= segment.displayStart && offset < end) {
      return segment.derivedFrom + Math.max(0, offset - segment.displayStart - before);
    }
  }
  const last = segments[segments.length - 1]!;
  const end = last.displayStart + (last.kind === 'edit' ? last.beforeLength : 0) + last.derivedTo - last.derivedFrom;
  return offset === end ? last.derivedTo : null;
}

export function rebaseViewport(anchor: ViewportAnchor, before: string, after: string): ViewportAnchor {
  return { ...anchor, derivedOffset: snapshotChange(before, after).mapPos(Math.max(0, Math.min(anchor.derivedOffset, before.length)), -1) };
}

/** Only explicitly annotated text participates. Marker glyphs never do. */
export function comparisonTextRange(container: HTMLElement, from: number, to = from): Range | null {
  const spans = container.querySelectorAll<HTMLElement>('[data-display-start]');
  function point(offset: number): { node: Node; offset: number } | null {
    let last: { node: Node; offset: number } | null = null;
    for (const span of spans) {
      const start = Number(span.dataset.displayStart);
      const end = Number(span.dataset.displayEnd);
      const node = span.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE) continue;
      if (offset >= start && offset < end) return { node, offset: offset - start };
      if (offset === end) last = { node, offset: end - start };
    }
    return last;
  }
  const start = point(from);
  const end = point(to);
  if (start === null || end === null) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

export function captureComparisonViewport(container: HTMLElement, segments: readonly ComparisonSegment[]): ViewportAnchor | null {
  const top = container.getBoundingClientRect().top;
  for (const span of container.querySelectorAll<HTMLElement>('[data-display-start]')) {
    const node = span.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE || node.textContent === '') continue;
    const rects = Array.from(span.getClientRects());
    if (!rects.some(rect => rect.bottom > top && rect.height > 0)) continue;
    // Range geometry supports wrapped text and newlines without inspecting the
    // concatenated DOM (which includes edit/signal marker buttons).
    const text = node.textContent!;
    const range = document.createRange();
    const rectAt = (offset: number): DOMRect => {
      while (offset < text.length - 1 && /[\r\n]/.test(text[offset]!)) offset++;
      range.setStart(node, offset);
      range.setEnd(node, Math.min(text.length, offset + (text.codePointAt(offset)! > 0xffff ? 2 : 1)));
      return range.getBoundingClientRect();
    };
    let low = 0;
    let high = text.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (rectAt(mid).bottom <= top) low = mid + 1;
      else high = mid;
    }
    while (low < text.length - 1 && /[\r\n]/.test(text[low]!)) low++;
    // Never return the second code unit of a surrogate pair as a visual anchor.
    if (low > 0 && /[\uDC00-\uDFFF]/.test(text[low]!)) low--;
    const rect = rectAt(low);
    const derivedOffset = displayOffsetToDerived(segments, Number(span.dataset.displayStart) + low);
    if (derivedOffset !== null && rect.height > 0) return { derivedOffset, topOffset: rect.top - top };
  }
  return segments.length === 0 ? { derivedOffset: 0, topOffset: 0 } : null;
}

export function restoreComparisonViewport(container: HTMLElement, segments: readonly ComparisonSegment[], anchor: ViewportAnchor): boolean {
  const length = segments[segments.length - 1]?.derivedTo ?? 0;
  const offset = Math.max(0, Math.min(anchor.derivedOffset, length));
  const display = derivedRangeToDisplayRange(segments, offset, offset);
  if (display === null) return false;
  let range = comparisonTextRange(container, display.from);
  // At EOF or an empty line Chromium may omit a collapsed caret rectangle.
  if (range !== null && range.getBoundingClientRect().height === 0) {
    range = comparisonTextRange(container, display.from, display.from + 1)
      ?? comparisonTextRange(container, Math.max(0, display.from - 1), display.from);
  }
  if (range === null) return length === 0;
  const rect = range.getBoundingClientRect();
  if (rect.height === 0) {
    // An EOF consisting only of line breaks has no text rectangle. Its
    // nearest visible position is the bottom edge, where clamping is allowed.
    if (offset === length) { container.scrollTop = container.scrollHeight; return true; }
    return false;
  }
  container.scrollTop += rect.top - container.getBoundingClientRect().top - anchor.topOffset;
  return true;
}
