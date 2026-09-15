import { makeAnchor } from '@galley-desk/pocket-format';
import type { Edit, Review } from '@galley-desk/pocket-format';
import { rebuild, type ChapterModel, type TextChange } from './model';
import { byteOffsetAt, decodeStrict, normalizeEol, pieceSpans, withSourceEol, type PieceSpan } from './pieces';

/**
 * Applies derived-text changes as one logical transaction: validates the
 * changes in old coordinates, computes the minimal covering source range
 * together with every absorbed replacement piece, reuses the UUID of the
 * leftmost affected edit (otherwise mints a new id), drops the absorbed
 * records and rebuilds the derived pieces from the updated review.
 */
export function changeText(
  model: ChapterModel,
  changes: TextChange[],
  selection: { anchor: number; head: number },
  newId: () => string,
): ChapterModel {
  // v1: creating edits in an empty chapter is unavailable.
  if (model.source.length === 0) throw new Error('EMPTY_SOURCE');
  const prepared = prepareChanges(changes, model.text);
  if (prepared.length === 0) return rebuild(model.source, model.review, selection);

  const spans = pieceSpans(model.pieces);
  let coverFrom = Number.POSITIVE_INFINITY;
  let coverTo = Number.NEGATIVE_INFINITY;
  for (const change of prepared) {
    coverFrom = Math.min(coverFrom, change.from);
    coverTo = Math.max(coverTo, change.to);
  }
  // Every replacement piece inside the covering range is affected — even one
  // that no single change touches but the covering range spans across.
  const affected = absorbCoveredPieces(prepared, spans, coverFrom, coverTo);
  for (const index of affected) {
    const span = spans[index] as PieceSpan;
    coverFrom = Math.min(coverFrom, span.start);
    coverTo = Math.max(coverTo, span.end);
  }

  const sourceFrom = byteOffsetAt(model.pieces, model.source, coverFrom, 'from');
  const sourceTo = byteOffsetAt(model.pieces, model.source, coverTo, 'to');

  let derived = model.text;
  for (let index = prepared.length - 1; index >= 0; index--) {
    const change = prepared[index] as TextChange;
    derived = derived.slice(0, change.from) + change.insert + derived.slice(change.to);
  }
  const delta = prepared.reduce((sum, change) => sum + change.insert.length - (change.to - change.from), 0);
  const after = withSourceEol(derived.slice(coverFrom, coverTo + delta), model.source);

  const before = decodeStrict(model.source.subarray(sourceFrom, sourceTo));
  const id = leftmostAffectedEditId(spans, affected) ?? newId();
  const replacement: Edit[] =
    before === after ? [] : [{ id, before, after, anchor: makeAnchor(model.source, { from: sourceFrom, to: sourceTo }) }];

  const absorbedIds = absorbedEditIds(spans, affected);
  const review: Review = {
    ...model.review,
    edits: [...model.review.edits.filter((edit) => !absorbedIds.has(edit.id)), ...replacement],
  };
  return rebuild(model.source, review, selection);
}

/** Sorts by position, normalizes pasted EOLs and validates old coordinates. */
function prepareChanges(changes: TextChange[], text: string): TextChange[] {
  const sorted = changes
    .map((change) => ({ from: change.from, to: change.to, insert: normalizeEol(change.insert) }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  let previous: TextChange | undefined;
  for (const change of sorted) {
    assertWithinText(change, text);
    if (
      previous !== undefined &&
      (change.from < previous.to || (change.from === previous.from && change.to === previous.to))
    ) {
      throw new Error('Text changes must not overlap in old coordinates');
    }
    previous = change;
  }
  const extended = sorted.map((change) => extendPureInsertion(change, text));
  let grown: TextChange | undefined;
  for (const change of extended) {
    if (
      grown !== undefined &&
      (change.from < grown.to || (change.from === grown.from && change.to === grown.to))
    ) {
      throw new Error('Text changes must not overlap in old coordinates');
    }
    grown = change;
  }
  return extended;
}

/**
 * An edit record needs a non-empty before text, so a pure insertion is
 * extended onto a neighboring code point — left neighbor first, at BOF the
 * right one — and keeps the insertion position inside its replacement text.
 */
function extendPureInsertion(change: TextChange, text: string): TextChange {
  if (change.from !== change.to || text.length === 0) return change;
  if (change.from > 0) {
    const left = codePointStart(text, change.from);
    return { from: left, to: change.from, insert: text.slice(left, change.from) + change.insert };
  }
  const firstEnd = codePointEnd(text, 0);
  return { from: 0, to: firstEnd, insert: change.insert + text.slice(0, firstEnd) };
}

function codePointStart(text: string, pos: number): number {
  const low = text.charCodeAt(pos - 1);
  const high = pos > 1 ? text.charCodeAt(pos - 2) : 0;
  if (low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff) return pos - 2;
  return pos - 1;
}

function codePointEnd(text: string, pos: number): number {
  const high = text.charCodeAt(pos);
  const low = text.charCodeAt(pos + 1);
  if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) return pos + 2;
  return pos + 1;
}

function assertWithinText(change: TextChange, text: string): void {
  const inBounds =
    Number.isSafeInteger(change.from) &&
    Number.isSafeInteger(change.to) &&
    change.from >= 0 &&
    change.from <= change.to &&
    change.to <= text.length;
  if (!inBounds) throw new Error('Text change is outside the derived text');
  assertCodePointBoundary(text, change.from);
  assertCodePointBoundary(text, change.to);
}

/** A boundary inside a surrogate pair is rejected so no symbol is ever cut. */
function assertCodePointBoundary(text: string, pos: number): void {
  if (pos === 0 || pos === text.length) return;
  const before = text.charCodeAt(pos - 1);
  const after = text.charCodeAt(pos);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    throw new Error('Text change splits a surrogate pair');
  }
}

function absorbCoveredPieces(
  prepared: TextChange[],
  spans: PieceSpan[],
  hullFrom: number,
  hullTo: number,
): Set<number> {
  const affected = new Set<number>();
  let coverFrom = hullFrom;
  let coverTo = hullTo;
  let grew = true;
  while (grew) {
    grew = false;
    spans.forEach((span, index) => {
      if (span.piece.editId === undefined || affected.has(index)) return;
      const overlapsHull = span.start < coverTo && coverFrom < span.end;
      const emptyAtPoint = span.start === span.end && coverFrom <= span.start && span.start <= coverTo;
      if (overlapsHull || emptyAtPoint) {
        affected.add(index);
        coverFrom = Math.min(coverFrom, span.start);
        coverTo = Math.max(coverTo, span.end);
        grew = true;
      }
    });
  }
  return affected;
}

function absorbedEditIds(spans: PieceSpan[], affected: Set<number>): Set<string> {
  const ids = new Set<string>();
  for (const index of affected) {
    const editId = (spans[index] as PieceSpan).piece.editId;
    if (editId !== undefined) ids.add(editId);
  }
  return ids;
}

function leftmostAffectedEditId(spans: PieceSpan[], affected: Set<number>): string | undefined {
  let leftmost: { id: string; from: number } | undefined;
  for (const index of affected) {
    const piece = (spans[index] as PieceSpan).piece;
    if (piece.editId !== undefined && (leftmost === undefined || piece.source.from < leftmost.from)) {
      leftmost = { id: piece.editId, from: piece.source.from };
    }
  }
  return leftmost?.id;
}
