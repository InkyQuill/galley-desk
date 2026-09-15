import type { Range, Review } from '@galley-desk/pocket-format';
import { byteOffsetAt, buildPieces } from './pieces';

/** A text replacement in derived-text UTF-16 code units. */
export type TextChange = { from: number; to: number; insert: string };

/** One derived fragment: editor text plus its origin in the source bytes. */
export type Piece = { text: string; source: Range; editId?: string };

export type ChapterModel = {
  source: Uint8Array;
  review: Review;
  pieces: Piece[];
  text: string;
  selection: { anchor: number; head: number };
};

/**
 * Opens a chapter for editing: applies active edits to the exact source bytes
 * and keeps the origin of every derived fragment. The source bytes are never
 * modified; edits live in the review sidecar only.
 */
export function openChapter(source: Uint8Array, review: Review): ChapterModel {
  return rebuild(source, review, { anchor: 0, head: 0 });
}

export function rebuild(source: Uint8Array, review: Review, selection: { anchor: number; head: number }): ChapterModel {
  const pieces = buildPieces(source, review);
  return { source, review, pieces, text: pieces.map((piece) => piece.text).join(''), selection };
}

/**
 * Maps a derived-text UTF-16 span onto the exact source byte range it covers.
 * A span strictly inside a replacement piece resolves to that edit's whole
 * source range; a mixed selection covers the entire source range in between.
 */
export function sourceRange(model: ChapterModel, from: number, to: number): Range {
  return {
    from: byteOffsetAt(model.pieces, model.source, from, 'from'),
    to: byteOffsetAt(model.pieces, model.source, to, 'to'),
  };
}
