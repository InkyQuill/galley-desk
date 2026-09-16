# Task 2 independent review

Reviewed e8a16f0..1f18732 against the Task 2 brief, production plan/global constraints, and the original presentation specification. Read-only review; no tests rerun, repository edits, git mutations, or child agents. Inspected the supplied Electron screenshot. The initial combined diff output truncated its marker section; that section was recovered from the corresponding current source. Follow-up reads were limited to the named color, selection, acknowledgement, and full-before-text risks.

## Verdict

- **Spec: Needs fixes** — one semantic presentation mismatch remains; the requested editor behavior is otherwise implemented.
- **Quality: Needs fixes** — address the P2 item below. No additional functional blocker established by this review.

## Actionable finding

### P2 — Give ordinary edit pencils the same semantic color in the gutter and sidebar

`apps/desktop/src/renderer/editor/markers.ts:190-191`

An ordinary edit explicitly receives `var(--app-text-muted)` in the gutter, while the same edit uses `var(--desk-accent)` in `ReviewList.tsx:46`. The supplied `/tmp/desk-task2-gutter-preview.png` visibly confirms grey versus blue pencils for the same record; signals already preserve their type color across both locations. The original specification assigns an edit its own kind color alongside the signal type colors (lines 79-80), and presents gutter icons as the corresponding review record controls (lines 88-92). A neutral muted pencil breaks that association and can appear inactive beside the colored signal. Reuse the sidebar's ordinary-edit color for the gutter, preferably through a shared edit-marker color/token. Preserve the deliberate pure-deletion treatment unless the overall design explicitly changes it. Check the two locations together in light and dark screenshots; no CSS-value-mirroring test is needed.

## Scope checks

- `mappedRecords` maps both endpoints during optimistic transactions, retains zero-length deletion positions, and filters non-active/invalid records. Gutter and reveal consume this field; snapshot dispatch is gated while the command queue is pending. Range decorations continue mapping through changes.
- True CM `gutter`/`GutterMarker` controls provide distinct native buttons. Records are sorted by document position, then range end/id. A CM measurement pass aligns buttons to actual wrapped-row coordinates and assigns separate ordered columns. No inline icon or comment widgets remain.
- Edits retain soft range backgrounds; signals receive a bottom-third band using existing Pocket type colors. Pure deletion stays actionable through a named gutter button.
- Caret, hover, and gutter focus share the same safe-text tooltip. Preview does not request focus, dispatch manuscript changes/history commands, or create action dialogs. Nonempty selection suppresses preview, and the existing Tab selection path is preserved. Existing marker/highlight click delegation still opens RecordPopup.
- Escape consults preview dismissal before leaving Zen. Scroll dismisses preview. Deferred focus callbacks re-read actual focus and guard destruction; listeners are removed on teardown.
- Popup restoration uses public `findFromDOM`, `domAtPos`, and native Selection APIs, changes the native range only on mismatch, and preserves anchor/head direction. The existing guard prevents restoration over an already-focused input. No private CM observer access remains.
- The passive tooltip intentionally bounds visual height. The existing actionable edit popup renders the complete `record.before` as actual text without slicing/clamping, so full content remains accessible there. This satisfies the stated bounded-preview condition.
- Hover while an action popup is open can still show a passive preview, as reported. The tooltip neither takes focus nor intercepts pointer events, and the existing action popup remains the actionable surface. Suppressing it could reduce visual duplication, but no explicit spec prohibition or demonstrated functional failure warrants a required fix.

## Validation limits

The implementation report records 17 focused unit tests, typecheck/package success, a four-run selection restoration regression pair, and 14/14 focused Electron review tests. Those are author-reported results, not independently rerun here. Controller owns the final full suite and light/dark/compact/Zen screenshots. Native macOS remains unverified.
