# Task 2 report — viewport and caret stability

## Status

Completed and committed as `c9e03ee` (`fix(editor): preserve reading position through snapshot updates`). GUI/build slot released. No push or publication. Temporary fixtures and userData only; installed app and real books untouched. Root docs and untracked branding preserved.

## Reproduction and cause

Added a real Electron regression with 160 wrapped paragraphs. Paragraph 90 contains an existing deletion. The test selects and deletes its surrounding paragraph, then performs undo / redo / undo through session keyboard bindings. It checks complete CodeMirror text, exact caret offset, logical paragraph text, caret Y against the actual scroller bounds, focused editor, stable caret Y through deletion and history, final explicit navigation, and unchanged source file bytes.

Before the fix, this test failed after undo: text was restored correctly but the caret moved 11,904.609375 px from its baseline (offscreen). Evidence: `/tmp/galley-task2-red.log`.

`applyPending` replaced the complete CodeMirror document for authoritative snapshots. This mapped its viewport anchor to a document edge and restored an unmapped numeric anchor, rather than preserving the live logical selection.

## Implementation

- Added `snapshotChange`: match common complete lines, then common characters within the changed span, leaving unchanged prefix/suffix available to CodeMirror mapping.
- Line matching is significant: character-only matching of `Remove\nReading` → `Reading` incorrectly preserves the first `Re` and maps the surviving Reading selection two characters forward. A unit test caught that edge case during implementation.
- Same-chapter sync maps the live selection with left affinity at an insertion boundary, and maps CodeMirror's native `scrollSnapshot()` through the change. This preserves a text anchor and its native scroll offset rather than restoring a fixed absolute scrollTop.
- Capture occurs when the deferred plan is applied, so it uses the current view after IME deferral.
- A no-op same-chapter snapshot does not collapse or restore stale selection.
- Chapter switches retain their explicit anchor selection and scrolling, including when two chapter texts happen to be identical.
- Existing stale React snapshot revision guard, FIFO, dirty acknowledgment handling, blocked queue behavior, and IME guards were retained.

## Verification

- `npm run package`: passed before each Electron run that followed renderer changes.
- RED: new Electron regression failed on old implementation at the geometry assertion; see `/tmp/galley-task2-red.log`.
- `npx vitest run apps/desktop/src/renderer/editor/snapshot-change.test.ts apps/desktop/src/renderer/editor/transaction-adapter.test.ts`: **17 passed**, including Unicode/empty document mapping and existing queue/adapter checks. `/tmp/galley-task2-unit.log`.
- `npm run typecheck`: passed, including final renderer change. `/tmp/galley-task2-typecheck.log`.
- Focused Electron suite: `review-actions.spec.ts`, `edit-and-reopen.spec.ts`, `open-book.spec.ts`: **26 passed** (38.9s). Includes rapid 50-transaction input with acknowledgments, chapter switch while typing, native Chromium composition commit/cancel, persistence, popup focus, markers, and chapter restoration. `/tmp/galley-task2-focused.log`.
- After the no-op/switch follow-up and fresh package, selected viewport/chapter restoration/search tests: **6 passed** (6.4s). `/tmp/galley-task2-final.log`.
- `git diff --check`: passed.

All Electron runs used the required `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test ... --workers=1` invocation. Builds and GUI tests did not overlap.

## Self-review and limits

Reviewed scoped diff for accidental document writes, selection semantics, effect mapping coordinates, chapter navigation, and unchanged concurrency gates. No source/sidecar schema or write path changed.

The snapshot helper represents one bounded changed span. It preserves unchanged text before and after that span; arbitrary simultaneous distant mutations can still map positions inside the combined span to a boundary. Normal contiguous history and the reported paragraph deletion regression are covered. It is not a general multi-hunk diff algorithm. Positions in text that is genuinely removed necessarily map to a surviving boundary.

The initial trial of Ctrl+Shift+Z did not trigger redo in the Linux test environment; the regression uses the existing supported Ctrl+Y session binding. Shortcut behavior itself was not changed.

## Controller follow-up clarification
The implementer confirmed the failed trial used `ControlOrMeta+Shift+z` with lowercase z. A focused probe of the installed CM keymap confirms lowercase key+Shift invokes undo while uppercase Z+Shift invokes redo. This is evidence of a synthetic-event test artifact, not an established application shortcut defect. Uppercase Electron redo will be checked during frame/final integration.

Controller real Electron follow-up passed at c44b2b0: `Control+z` undoes abcX→abc, `Control+Shift+Z` restores abcX, with captured key `Z`/code `KeyZ`/ctrl+shift. Temporary fixture/profile under required Xvfb; /tmp/desk-uppercase-redo.mts. Linux shifted redo is verified; macOS runtime remains unverified.
