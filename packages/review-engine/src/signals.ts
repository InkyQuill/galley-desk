import { makeAnchor } from '@galley-desk/pocket-format';
import type { Review, Signal, SignalType } from '@galley-desk/pocket-format';
import { rebuild, sourceRange, type ChapterModel } from './model';
import { decodeStrict } from './pieces';

/**
 * Marks the derived-text selection as a signal anchored to the exact source
 * bytes: the range is mapped back through sourceRange, selected_text is always
 * decoded from the original bytes (never from the derived replacement text)
 * and the anchor is built over that source range. The model is rebuilt with
 * its selection preserved; signals never touch the derived text.
 */
export function addSignal(
  model: ChapterModel,
  from: number,
  to: number,
  type: SignalType,
  comment: string,
  id: string,
): ChapterModel {
  const range = sourceRange(model, from, to);
  const signal: Signal = {
    id,
    type,
    comment,
    selected_text: decodeStrict(model.source.subarray(range.from, range.to)),
    anchor: makeAnchor(model.source, range),
  };
  const review: Review = { ...model.review, signals: [...model.review.signals, signal] };
  return rebuild(model.source, review, model.selection);
}

/**
 * Removes only the edit or the signal with the given id — never both, never a
 * cascade over other records — and rebuilds the model with its selection.
 * Removing an edit keeps its signals: records are stored independently.
 */
export function removeRecord(model: ChapterModel, id: string): ChapterModel {
  const review: Review = {
    ...model.review,
    edits: model.review.edits.filter((edit) => edit.id !== id),
    signals: model.review.signals.filter((signal) => signal.id !== id),
  };
  return rebuild(model.source, review, model.selection);
}

/** Changes only chapter_note, leaving every record and the selection intact. */
export function setChapterNote(model: ChapterModel, text: string): ChapterModel {
  return rebuild(model.source, { ...model.review, chapter_note: text }, model.selection);
}
