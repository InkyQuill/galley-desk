# Task 3 report

## Status and scope

Complete; scoped commit `c44b2b0` (`fix(desktop): improve review annotations and popup interactions`). Preserved `c9e03ee` viewport synchronization and `95fdf15` engine behavior. No source, sidecar, schema, IPC or storage implementation changed. No real user books or installed app touched. Root-owned docs/assets remain uncommitted and untouched by this worker.

## Implementation

- Added presentation-only `visualRecord` helper: normalizes CRLF/CR to editor LF coordinates, trims common prefixes/suffixes by Unicode code points, preserves serialized anchors and stored strings. Cached by immutable record identity. Markers, gutter position, previews and explicit editor reveal all use the visual range.
- Pure deletions now use a small inline Tabler trash button, without original text inline. Hover shows the removed text and clicking opens the edit action popup.
- Signal comments render as safe `textContent` in CodeMirror block widgets below the containing blank-line-delimited paragraph. Multiple comments follow resolved record order. Small UI font and signal palette color; long comments scroll instead of enlarging indefinitely. Copy test verifies only the derived manuscript reaches the clipboard.
- Passive previews support signal comments, respect selection/focus, close on pointer exit, and use styled tooltips. Removed native gutter titles. Long previews are bounded by viewport size and scrollable.
- Edit action popup closes on outside pointer down, caret leaving its range, or pointer leaving both anchor and popup with a 220ms grace. Moving within popup preserves it. Signal forms keep unsaved drafts on pointer movement. Existing Escape/native CodeMirror selection restoration remains.
- Signal selection and editing use bundled colored Tabler icons with Russian accessible labels and tooltips. Forms are 440px on desktop, bounded to the available surface, with six-row textareas and explicit cancellation.
- Review list uses resolved position order, stable input order for ties, inactive/unavailable last.
- Drag selections in decorated text no longer trigger the click action popup.

## Regression evidence

- Added `visual-range.test.ts` first and observed RED (missing helper), then implemented: prefix/suffix insertion, support-retaining deletion, CRLF and astral Unicode, immutable stored text, stable reading order.
- Updated former no-widgets assertions to expect comments and deletion placeholders while preserving source-coordinate assertions; added actual clipboard/safe-text Electron coverage.
- Initial packaged run exposed 4–5px viewport/gutter drift from the trash widget: global button padding and widget rectangle were affecting caret geometry. Explicit small button dimensions and public WidgetType.coordsAt using adjacent text coordinates fixed it. Original strict `<4px` viewport and `<5px` gutter assertions remain unchanged and pass.
- `npm run typecheck`: PASS.
- `npx vitest run apps/desktop/src/renderer/editor/markers.test.ts apps/desktop/src/renderer/editor/visual-range.test.ts apps/desktop/src/renderer/editor/snapshot-change.test.ts`: 12 PASS.
- `npm run package`: PASS after final renderer changes, before native tests.
- Real Electron command: `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/review-actions.spec.ts --workers=1 --grep 'gutter|long chapter deletion|сигнал|review annotation'`.
- Final packaged implementation: nine existing focused cases PASS (signal creation/cancellation/editing/overlap, inserted-text anchors, rejection preservation, passive preview typing/keyboard actions, wrapped gutter, long-chapter deletion undo/redo). Combined new annotation test initially had a fixture locator mistake after engine moved an edited signal to the end of equal-position records; targeting its stable ID corrected the test. Rerun `--grep 'review annotation'`: PASS (2.3s).
- New native case covers actual highlighted text, safe comment DOM and order, below-paragraph placement, trash preview/click, popup gap crossing and pointer exit, caret exit, outside-input focus, support-character preview absence, actual system clipboard contents, draft persistence, 440px form, theme switching, 36KB comment preview viewport bounds and dismissal.
- `git diff --cached --check`: PASS before commit.

## Screenshots

- `/tmp/galley-task3-signal-light.png`: light signal form and annotations.
- `/tmp/galley-task3-annotations-dark.png`: dark annotations, trash placeholder, safe comment text, ordered review list.
- Worker inspected both screenshots; no header icon changes or separate editor paper card introduced.

## Integration and remaining validation

- GUI/build slot released. No worker processes running.
- Full suite and final 1MiB/500-record performance budget are intentionally left to controller per assignment; avoid claiming these have passed yet.
- Paragraph placement currently follows manuscript blank-line paragraph boundaries; special Markdown block parsing is not introduced.
- Stable tie order follows the engine's current record array (a metadata update may move a tied signal within that array); no storage ordering changes made.

## Fix round 1 — completed

Scoped follow-up commit `f78aa2b` (`fix(desktop): map live review presentation ranges during pending input`). All three accepted P2 findings fixed, no broader feature scope.

1. Paragraph comments use the last selected character for nonempty ranges. Selected blank separators walk back to their preceding paragraph before finding its end. Unit tests for source `one\n\nTwo` and endpoints 4/5 initially failed with widget at 8 instead of 3; both now pass. Native tests verify the comment is physically between `one` and `Two`, and source stays unchanged.
2. Added `mappedVisualRecords` CodeMirror StateField. Authoritative marker effects trim storage ranges once; subsequent transactions map those visual endpoints directly, in parallel with storage endpoints and decorations. Gutter, passive preview and reveal consume this live field. Unit test proves pending support-prefix insertion maps X from 2..3 to 3..4 and matches the mapped decoration, then rebuilds from acknowledged content. Delayed-command Electron regression initially failed with gutter data-record-pos 2 instead of 3 while X's highlight had already moved; now checks highlight, gutter, support-character absence of preview, actual X preview, and revealed selection before acknowledgement, and rebuilt highlight/gutter/preview/reveal after acknowledgement.
3. Edit popup caret dismissal resolves record ID against the current editor mapped presentation field. Native delayed-command test initially lost the popup after inserting QQQQ inside XYZ because caret exceeded the stale snapshot end; now popup remains during the held response and after acknowledgement, and still closes when the caret moves outside.

### Round 1 validation

- RED: unit paragraph cases failed `[8]` vs `[3]`; missing live visual field failed before implementation.
- RED: both native delayed-command tests failed against the previously packaged c44b2b0 renderer for the exact reviewed reasons above. Test-only IPC command gate holds before the real command handler, so storage/snapshot acknowledgements genuinely lag native input. Gates are released in finally; real application is never affected.
- GREEN: `npm run typecheck` passed.
- GREEN: markers, visual-range, snapshot-change Vitest files: 15 passed.
- GREEN: `npm run package` passed after implementation, before native verification.
- GREEN: native `--grep 'delayed ACK|paragraph annotation|gutter|long chapter deletion|review annotation'`: 8 passed (8.4s). This includes unchanged strict viewport/gutter tests, full existing safe comments/copy/draft case, both delayed-command regressions and both paragraph placement cases.
- GREEN: after adding explicit post-ack preview and pre-ack support-character preview assertions, native `--grep 'delayed ACK'`: 2 passed (2.5s).
- All native runs used the prescribed sanitized environment, xvfb-run and one worker.
- `git diff --cached --check` passed before commit. Worker self-reviewed scoped diff; all existing substantive tests preserved.
- GUI/build slot released. No full suite/performance run done; those remain with controller. Root docs and user assets remain untouched.
