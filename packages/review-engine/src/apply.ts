import { classifyReview, makeAnchor } from '@galley-desk/pocket-format';
import type { Edit, Review, Signal } from '@galley-desk/pocket-format';
import { rebuild, type ChapterModel } from './model';
import { decodeStrict } from './pieces';

const textEncoder = new TextEncoder();

/**
 * Applies one active correction to the exact source bytes: the resolved byte
 * range is replaced with the record's `after` bytes and the record is removed
 * from the review, so the source and the derived text converge.
 *
 * Every other active record strictly before the replacement keeps its anchor;
 * strictly after it, the record shifts by the byte-length delta of the
 * replacement and gets a fresh `makeAnchor` over the new source. Unavailable
 * and conflicting records are kept untouched — nothing is re-anchored by
 * guesswork and nothing is deleted automatically. Signals outside the
 * replacement move the same way; a signal lying entirely inside the
 * replacement is removed; a signal spanning the whole replacement keeps
 * covering it over the corrected bytes; a partially overlapping signal keeps
 * its original anchor. Moved records refresh their text from the new source.
 * No text search is involved anywhere: the replacement and the byte shift are
 * known exactly.
 */
export function applyEdit(model: ChapterModel, id: string): ChapterModel {
  const availability = classifyReview(model.source, model.review);
  const range = availability.edits.get(id);
  if (range === undefined) throw new Error(`Edit is not active: ${id}`);
  const edit = model.review.edits.find((candidate) => candidate.id === id) as Edit;

  const afterBytes = textEncoder.encode(edit.after);
  const source = concatBytes(model.source.subarray(0, range.from), afterBytes, model.source.subarray(range.to));
  const shift = afterBytes.length - (range.to - range.from);

  const movedEdit = (candidate: Edit, oldRange: { from: number; to: number }): Edit => {
    const moved = { from: oldRange.from + shift, to: oldRange.to + shift };
    return {
      ...candidate,
      before: decodeStrict(source.subarray(moved.from, moved.to)),
      anchor: makeAnchor(source, moved),
    };
  };
  const edits = model.review.edits.flatMap((candidate): Edit[] => {
    if (candidate.id === id) return [];
    const oldRange = availability.edits.get(candidate.id);
    // Inactive (stale, ambiguous or conflicting) records never move.
    if (oldRange === undefined) return [candidate];
    if (oldRange.from >= range.to) return [movedEdit(candidate, oldRange)];
    // Active records never overlap, so everything left of the replacement
    // (including records ending exactly at its start) keeps its anchor.
    return [candidate];
  });

  const movedSignal = (signal: Signal, moved: { from: number; to: number }): Signal => ({
    ...signal,
    selected_text: decodeStrict(source.subarray(moved.from, moved.to)),
    anchor: makeAnchor(source, moved),
  });
  const signals = model.review.signals.flatMap((signal): Signal[] => {
    const oldRange = availability.signals.get(signal.id);
    // Unavailable signals are kept exactly as stored.
    if (oldRange === undefined) return [signal];
    if (oldRange.to <= range.from) return [signal];
    if (oldRange.from >= range.to) return [movedSignal(signal, { from: oldRange.from + shift, to: oldRange.to + shift })];
    // The replacement consumed the whole selection: the signal is gone with it.
    if (oldRange.from >= range.from && oldRange.to <= range.to) return [];
    // The signal spans the whole replacement: it keeps covering it, now over
    // the corrected bytes — every byte of the new selection is known exactly.
    if (oldRange.from <= range.from && oldRange.to >= range.to) {
      return [movedSignal(signal, { from: oldRange.from, to: oldRange.to + shift })];
    }
    // Partial overlap: ownership of the surviving bytes is ambiguous, so the
    // original anchor stays and the record is kept without changes.
    return [signal];
  });

  const review: Review = { ...model.review, edits, signals };
  return rebuild(source, review, model.selection);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
