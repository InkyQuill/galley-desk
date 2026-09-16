import { classifyReview } from '@galley-desk/pocket-format';
import type { Review } from '@galley-desk/pocket-format';
import type { Piece } from './model';

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/** Derived text is edited with LF line endings regardless of the source. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Strict UTF-8 decoding; source slices are never decoded leniently. */
export function decodeStrict(bytes: Uint8Array): string {
  return strictUtf8.decode(bytes);
}

/**
 * The EOL style of the source's first line break; LF when the source has no
 * line breaks at all. New EOLs written into edit records follow this style,
 * while the derived text itself stays LF-normalized.
 */
export function sourceEol(source: Uint8Array): string {
  for (let index = 0; index < source.length; index++) {
    if (source[index] === 0x0a) {
      return index > 0 && source[index - 1] === 0x0d ? '\r\n' : '\n';
    }
  }
  return '\n';
}

/** Converts LF-normalized editor text back into the source's EOL style. */
export function withSourceEol(text: string, source: Uint8Array): string {
  const eol = sourceEol(source);
  return eol === '\n' ? text : text.replace(/\n/g, eol);
}

/**
 * Builds the derived pieces of a chapter: unchanged source slices between the
 * sorted active replacement ranges. Only valid, non-conflicting (active) edits
 * produce replacement pieces; inactive, stale, ambiguous and conflicting
 * records stay in the review without reaching the derived text.
 */
export function buildPieces(source: Uint8Array, review: Review): Piece[] {
  const availability = classifyReview(source, review);
  const active = review.edits
    .flatMap((edit) => {
      const range = availability.edits.get(edit.id);
      return range ? [{ edit, range }] : [];
    })
    .sort((left, right) => left.range.from - right.range.from);

  const pieces: Piece[] = [];
  let bytePos = 0;
  for (const { edit, range } of active) {
    if (range.from > bytePos) pieces.push(sourcePiece(source, bytePos, range.from));
    pieces.push({ text: normalizeEol(edit.after), source: range, editId: edit.id });
    bytePos = range.to;
  }
  if (bytePos < source.length) pieces.push(sourcePiece(source, bytePos, source.length));
  return pieces;
}

function sourcePiece(source: Uint8Array, from: number, to: number): Piece {
  return { text: normalizeEol(decodeStrict(source.subarray(from, to))), source: { from, to } };
}

export type PieceSpan = { piece: Piece; start: number; end: number };

/** UTF-16 [start, end) span of every piece inside the derived text. */
export function pieceSpans(pieces: Piece[]): PieceSpan[] {
  const spans: PieceSpan[] = [];
  let start = 0;
  for (const piece of pieces) {
    const end = start + piece.text.length;
    spans.push({ piece, start, end });
    start = end;
  }
  return spans;
}

export type BoundarySide = 'from' | 'to';

/**
 * Maps a derived-text UTF-16 boundary onto a source byte offset.
 *
 * Boundaries at piece edges map to the piece's own source edges; a boundary
 * strictly inside a replacement piece refers to the originating replacement
 * range (never invented byte positions), so the 'from' side snaps to the
 * range start and the 'to' side to its end. A zero-length replacement piece
 * occupies one derived position and maps to its whole source range. Interior
 * boundaries of unchanged pieces map to the exact byte offset.
 */
export function byteOffsetAt(pieces: Piece[], source: Uint8Array, pos: number, side: BoundarySide): number {
  let start = 0;
  for (const piece of pieces) {
    const end = start + piece.text.length;
    if (piece.editId !== undefined) {
      if (piece.text.length === 0) {
        if (pos === start) return side === 'from' ? piece.source.from : piece.source.to;
      } else if (pos === start) {
        return piece.source.from;
      } else if (pos < end) {
        return side === 'from' ? piece.source.from : piece.source.to;
      }
    } else if (pos <= end) {
      return piece.source.from + byteOffsetInSlice(piece, pos - start, source);
    }
    start = end;
  }
  const last = pieces[pieces.length - 1];
  return last ? last.source.to : source.length;
}

/** Exact byte offset of a UTF-16 boundary inside an unchanged piece. */
function byteOffsetInSlice(piece: Piece, offsetInPiece: number, source: Uint8Array): number {
  const decoded = decodeStrict(source.subarray(piece.source.from, piece.source.to));
  // TextDecoder omits a leading UTF-8 BOM from each decoded slice, but
  // source anchors still count its three bytes.
  const from = piece.source.from;
  let byteOffset = source[from] === 0xef && source[from + 1] === 0xbb && source[from + 2] === 0xbf ? 3 : 0;
  let outUnits = 0;
  let index = 0;
  while (outUnits < offsetInPiece && index < decoded.length) {
    const code = decoded.codePointAt(index);
    if (code === undefined) break;
    if (code === 0x0d) {
      // CRLF and lone CR collapse into one LF output unit.
      const crlf = index + 1 < decoded.length && decoded.charCodeAt(index + 1) === 0x0a;
      byteOffset += crlf ? 2 : 1;
      outUnits += 1;
      index += crlf ? 2 : 1;
    } else {
      byteOffset += utf8Length(code);
      const units = code > 0xffff ? 2 : 1;
      outUnits += units;
      index += units;
    }
  }
  return byteOffset;
}

function utf8Length(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}
