import { resolveAnchor } from './anchors';
import type { Availability, Range, Resolution, Review } from './documents';

/**
 * Classifies every record of a review against the exact source bytes.
 *
 * Records whose anchor resolves go to `edits`/`signals` with their resolved
 * range; everything else goes to `unavailable` with the failed resolution
 * (stale or ambiguous). Every participant of an edit range intersection is
 * excluded from the active map and reported in `conflicting` — none of the
 * participants can be applied to the derived text, and all of them stay in
 * the sidecar. Signals may intersect and never conflict.
 */
export function classifyReview(source: Uint8Array, review: Review): Availability {
  const edits = new Map<string, Range>();
  const signals = new Map<string, Range>();
  const unavailable = new Map<string, Resolution>();

  for (const signal of review.signals) {
    const resolution = resolveAnchor(source, signal.anchor, signal.selected_text);
    if (resolution.kind === 'resolved') signals.set(signal.id, resolution.range);
    else unavailable.set(signal.id, resolution);
  }
  for (const edit of review.edits) {
    const resolution = resolveAnchor(source, edit.anchor, edit.before);
    if (resolution.kind === 'resolved') edits.set(edit.id, resolution.range);
    else unavailable.set(edit.id, resolution);
  }

  const conflicting = new Set<string>();
  const active = [...edits.entries()];
  for (let left = 0; left < active.length; left++) {
    for (let right = left + 1; right < active.length; right++) {
      const leftEntry = active[left] as [string, Range];
      const rightEntry = active[right] as [string, Range];
      if (leftEntry[1].from < rightEntry[1].to && rightEntry[1].from < leftEntry[1].to) {
        conflicting.add(leftEntry[0]);
        conflicting.add(rightEntry[0]);
      }
    }
  }
  for (const id of conflicting) edits.delete(id);

  return { edits, signals, unavailable, conflicting };
}
