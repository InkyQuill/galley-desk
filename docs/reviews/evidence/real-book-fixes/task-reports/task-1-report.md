# Task 1 report — preserve prior deletions during composition

Status: DONE
Commit: `95fdf15` — `fix(review-engine): preserve absorbed deletion source ranges`

## Scope and result

Changed only `packages/review-engine/src/edit.ts` and added `packages/review-engine/src/deletion-composition.test.ts`. The ignored task report is recorded here for the coordinator. No real books, source files, sidecars, installed application, storage code, or UI code were modified. No push or publication.

Deleting a remaining blockquote marker now retains the original Pocket deletion instead of resurrecting the quote. Composed edits cover all bytes owned by absorbed edit records, including adjacent zero-width derived pieces.

## Root cause and fix

`absorbCoveredPieces` intentionally includes a deletion when its zero-width derived span lies on either boundary of the transaction's covering range. `byteOffsetAt`, however, can return the preceding unchanged piece's source endpoint before examining the deletion at the same derived position. The engine then removes the absorbed deletion record while constructing a replacement that does not cover the deleted bytes. Rebuilding displays those original bytes again.

`changeText` now unions the mapped source range with the source ranges of every absorbed piece before decoding `before` and creating the replacement anchor. Derived coverage and replacement `after` calculation remain unchanged, since the absorbed deletion contributes no visible text. Existing piece mapping semantics, Pocket v1 anchor generation, leftmost edit UUID reuse, and nonaffected records are preserved. Source coverage cannot extend into an unrelated visible replacement: only records already selected by the existing absorption algorithm enlarge it.

## RED evidence

Before the production change, `npx vitest run packages/review-engine/src/deletion-composition.test.ts` failed 9 of 13 tests, with 4 passing controls. Specific failures:

- Deleting `>` after an imported deletion of ` Удалённая цитата 😀` produced the previously deleted quote instead of empty text.
- Deleting `a` from derived `ab` backed by source `aXb` produced `Xb` instead of `b`.
- Adjacent deletion records resurrected `XY` at the right boundary and EOF.
- Both-boundary, Unicode, CRLF, insertion-at-deletion, and redo cases likewise exposed lost deleted source coverage.

The paragraph spanning an interior prior deletion, left-boundary deletion, and BOF cases passed as controls before the fix.

## GREEN evidence

Final checks after all changes:

- `npx vitest run packages/review-engine`: exit 0, **63 tests passed across 6 files**.
- `npx tsc -b packages/review-engine --pretty false`: exit 0.
- `git diff --check`: exit 0.

The new file contains 14 cases: imported blockquote deletion, whole paragraph spanning a deletion, either boundary, BOF/EOF, adjacent deletions, two boundaries, UTF-8/astral symbols, CRLF, insertion composition, undo/redo, and an independently active adjacent correction. Assertions cover derived text, exact stored `before`/`after`/anchor/identity, unchanged source bytes, review serialization and reopening, explicit apply bytes, and restored history snapshots. The neighboring correction keeps its original anchor before apply and remains independently applicable afterward.

## Self-review

Reviewed the production diff and tests. The fix is limited to source coverage after the existing absorption decision; it does not change classification, anchor resolution, signal mapping, schemas, or history. Existing identity, stale-record preservation, source mapping, and apply tests all pass. No known concerns. Full application validation and independent review are left to the coordinator as requested.
