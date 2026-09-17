import { derivedRangeToDisplayRange, type ComparisonSegment } from '../search/search';
import { ChangeSet } from '@codemirror/state';

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

// Bounded Myers matching: line tokens keep unchanged interior paragraphs;
// small changed line groups are refined by Unicode code point. Each matched
// token retains UTF-16 offsets through prefix sums. This mapper is only for
// reading anchors; editor snapshot replacement and Undo remain unchanged.
function matchingTokens(before: readonly string[], after: readonly string[], budget: { remaining: number }): [number, number][] {
  const prefix: [number, number][] = [];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    prefix.push([start, start]); start++;
  }
  let oldEnd = before.length;
  let newEnd = after.length;
  const suffix: [number, number][] = [];
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    suffix.push([--oldEnd, --newEnd]);
  }
  suffix.reverse();
  const n = oldEnd - start;
  const m = newEnd - start;
  if (n === 0 || m === 0) return [...prefix, ...suffix];
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  // 256 edit steps and a shared work budget bound both trace storage and work.
  // If exhausted, only this unresolved gap becomes a replacement; previously
  // matched prefix/suffix/other line groups are still retained.
  for (let depth = 0; depth <= Math.min(n + m, 256); depth++) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      if (--budget.remaining < 0) return [...prefix, ...suffix];
      let x = diagonal === -depth || (diagonal !== depth && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < n && y < m && before[start + x] === after[start + y]) {
        if (--budget.remaining < 0) return [...prefix, ...suffix];
        x++; y++;
      }
      frontier.set(diagonal, x);
      if (x < n || y < m) continue;
      const middle: [number, number][] = [];
      for (let step = depth; step >= 0; step--) {
        const previous = trace[step]!;
        const k = x - y;
        const previousK = k === -step || (k !== step && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0;
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) middle.push([start + --x, start + --y]);
        x = previousX; y = previousY;
      }
      return [...prefix, ...middle.reverse(), ...suffix];
    }
  }
  return [...prefix, ...suffix];
}

export function rebaseViewport(anchor: ViewportAnchor, before: string, after: string): ViewportAnchor {
  const position = Math.max(0, Math.min(anchor.derivedOffset, before.length));
  // A unique unchanged reading line is an exact anchor even when very large
  // edits on both sides exceed the diff budget. Ambiguous repeated lines use
  // ordered matching below instead of choosing an arbitrary occurrence.
  const lineStart = position === 0 ? 0 : before.lastIndexOf('\n', position - 1) + 1;
  const newline = before.indexOf('\n', position);
  const line = before.slice(lineStart, newline < 0 ? before.length : newline + 1);
  const match = after.indexOf(line);
  if (line.trim() !== '' && before.indexOf(line) === lineStart && before.lastIndexOf(line) === lineStart &&
      match >= 0 && after.lastIndexOf(line) === match && (match === 0 || after[match - 1] === '\n')) {
    return { ...anchor, derivedOffset: match + position - lineStart };
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  const budget = { remaining: 200_000 };
  const offsets = (tokens: readonly string[]): number[] => {
    const result = [0];
    for (const token of tokens) result.push(result[result.length - 1]! + token.length);
    return result;
  };
  const collect = (oldTokens: string[], newTokens: string[], oldBase: number, newBase: number, refine: boolean): void => {
    const oldOffsets = offsets(oldTokens);
    const newOffsets = offsets(newTokens);
    const matches = matchingTokens(oldTokens, newTokens, budget);
    matches.push([oldTokens.length, newTokens.length]);
    let oldIndex = 0;
    let newIndex = 0;
    for (const [oldMatch, newMatch] of matches) {
      if (oldIndex < oldMatch || newIndex < newMatch) {
        const from = oldBase + oldOffsets[oldIndex]!;
        const to = oldBase + oldOffsets[oldMatch]!;
        const newFrom = newBase + newOffsets[newIndex]!;
        const newTo = newBase + newOffsets[newMatch]!;
        if (refine && from < to && newFrom < newTo && to - from + newTo - newFrom <= 20_000 && budget.remaining > 0) {
          collect(Array.from(before.slice(from, to)), Array.from(after.slice(newFrom, newTo)), from, newFrom, false);
        } else changes.push({ from, to, insert: after.slice(newFrom, newTo) });
      }
      oldIndex = oldMatch + 1;
      newIndex = newMatch + 1;
    }
  };
  collect(before.match(/[^\n]*\n|[^\n]+$/g) ?? [], after.match(/[^\n]*\n|[^\n]+$/g) ?? [], 0, 0, true);
  // A retained character at an insertion boundary follows the inserted text;
  // an anchor deleted inside a replacement still clamps to its start.
  const association = changes.some(change => change.from === position && change.to === position) ? 1 : -1;
  return { ...anchor, derivedOffset: ChangeSet.of(changes, before.length).mapPos(position, association) };
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
