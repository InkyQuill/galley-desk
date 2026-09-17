# Final whole-branch Workspace UX review

Reviewed range: `773b1ab..e6cfabe`, including inherited tasks 7–10. Continuation base `537d4c4` is not the review base. Review performed read-only in passes over requirements, implementation, cross-feature state/layer ownership, targeted test assertions, the ledger, and permanent acceptance evidence. No tests or GUI sessions were rerun. Only this report was written.

## Strengths

- Settings now serialize the entire read/modify/write operation for appearance, layout, and reading positions. Validation, old-profile defaults, and the concurrency regression address the actual lost-update risk.
- Reorder validates a complete unique permutation inside the existing manifest freshness/save path. Existing live sessions, flush/recovery/conflict checks, UUIDs, and sidecars remain intact; service/native coverage checks Undo continuity.
- View switching uses viewport geometry, excludes marker glyphs from comparison offsets, rebases through settled edits, and scopes restore tickets to navigation and chapter. The two fix rounds materially improved correctness without changing input-history semantics.
- Metadata retains its opening source/YAML baseline, routes saves through the existing guarded source command, and distinguishes stale-form rejection from persistence failure.
- Verification evidence is unusually useful: real-copy scripted assertions, unchanged source hashes, permanent screenshots, and explicit macOS/system-IME limitations. Reported gates are 461 unit tests, typecheck/package, 21 TS contracts plus Kotlin, and 102 native passes with one expected performance skip. Those are recorded results, not tests independently rerun by this reviewer.

## Issues

### Critical

None established. No newly introduced on-disk corruption path was identified.

### Important — fix before merge

1. **The chapter action menu is clipped outside its sidebar.**
   - Location: `apps/desktop/src/renderer/app.css:87`, with the clipping ancestor at line 75; menu implementation `apps/desktop/src/renderer/book/ChapterMenu.tsx:5`.
   - The menu is absolutely positioned at `left: calc(100% + 4px)` relative to the rightmost menu-button container, while `.book__chapters` has `overflow-x: hidden`. Its 220px content therefore opens beyond the sidebar clip instead of over the center. Increasing z-index cannot escape this clip. The overlay adds another overflow-hidden ancestor.
   - This is also visible in the committed `docs/reviews/evidence/workspace-ux/task-13/real-book-sidebar-menu.png`: the opened first-row menu shows only a small dark sliver at the sidebar edge, with neither action readable. The evidence label does not establish successful visual acceptance. Playwright locator visibility/actionability or automatic scrolling is insufficient here.
   - Fix: render the menu in a themed unclipped layer (portal/fixed or native popover), position it from the trigger rect, and clamp both axes. Verify both actions are visibly inside the viewport without sidebar horizontal scrolling, including the last row and narrow overlay case.

2. **Responsive collapse and manual sidebar hiding silently discard an unsaved chapter note.**
   - Location: `apps/desktop/src/renderer/book/BookWindow.tsx:1126` and `:1159`; local draft owner `apps/desktop/src/renderer/review/ChapterNote.tsx:33`.
   - Enter a note draft, then narrow a 1280px window to 900px or press the review toggle. `reviewCollapsed` unmounts the only instance holding that draft. Opening the review overlay mounts a different `ChapterNote`, initialized from the saved snapshot; the typed note is gone. Expanding an open overlay has the same problem. Unlike the pre-existing Zen behavior, responsive/manual panel removal is newly introduced here and can lose work merely by resizing the window.
   - Fix: keep per-chapter draft/open/error state above the responsive branches, or preserve one mounted state owner across inline and overlay presentations. Apply that ownership consistently to Zen as well; do not implicitly save. Add a regression that types an unsaved draft and traverses hide/show, collapse/overlay/expand, and Zen.

3. **Escape still dismisses multiple layers because the window capture handler runs before layer handlers.**
   - Location: `apps/desktop/src/renderer/book/BookWindow.tsx:447`–`:494`; metadata handler `apps/desktop/src/renderer/book/MetadataPopover.tsx:54`–`:63`; chapter-menu handler `ChapterSidebar.tsx:57`.
   - Open search, then open metadata and press Escape in its textarea. Window capture first closes search at line 483; document capture subsequently closes metadata or opens its dirty-discard confirmation. `stopImmediatePropagation()` at document cannot undo a handler already executed on window. Search plus a chapter dialog similarly allows global search dismissal before native dialog cancel. In a sidebar overlay, the outer overlay is closed before a nested chapter menu/note can consume Escape. This contradicts the explicit one-Escape/one-layer contract and can compound the draft-loss issue above.
   - The same ownership gap leaves the real Diagnostics modal outside `modalOpen` (line 399): its Ctrl/Cmd+Alt+Z can toggle underlying Zen despite the modal requirement.
   - Fix: centralize topmost-layer ownership or make the global handler defer to open native dialogs, metadata, and local nested layers before acting. Consume handled events at the owning layer and include Diagnostics in modal shortcut blocking. Test search+clean metadata, search+dirty metadata, search+native dialog, nested overlay menu/note, and Diagnostics+Zen.

4. **The metadata popover is clipped when the center is narrower than 560px.**
   - Location: `apps/desktop/src/renderer/app.css:100`, with `overflow: hidden` on `.book__content` at `:92` and DOM nesting in `BookWindow.tsx:1045`.
   - `width: min(560px, calc(100vw - 32px))` is viewport-based, but this absolutely positioned popover remains inside the clipped center. At 1100px, fitLayout reserves a 480px center; after its 56px padding, a right-aligned 560px popover extends well beyond the center's left clip. Text/form controls are cut off even though the popover's own width meets the nominal spec. Its height is also bounded against the whole viewport, rather than available space below its actual origin.
   - Fix: place it in an unclipped themed layer and clamp position/available height to viewport bounds; changing only z-index is insufficient. Verify visible content and controls at 1100px, 900px, enlarged sidebars, and 125% zoom, including long YAML and the discard panel.

5. **Large shared tooltips are not bounded vertically and long tokens can paint outside their box.**
   - Location: `apps/desktop/src/renderer/app.css:15`–`:16`; `apps/desktop/src/renderer/ui/Tooltip.tsx:80`–`:86`.
   - ReviewList passes the complete before/after/comment into the shared Tooltip. CSS limits width only, with no max-height, overflow policy, or long-token wrapping. A sufficiently long comment creates a tooltip taller than the viewport; the positioning calculation clamps its top to 8px but cannot reduce its height. Long unbroken words can overflow the measured box horizontally. Existing dense-review assertions inspect the outer horizontal box only, so they do not establish the required large-preview bounds.
   - Fix: bound rendered preview height and wrap long tokens. Keep the existing click-open record card as the full-content path if the noninteractive tooltip is clipped. Add long multiline and long-token cases asserting visible painted content stays inside the viewport at 125% zoom.

### Minor — nonblocking

1. **Closing a chapter dialog launched from a collapsed-sidebar overlay has no connected focus target.** `BookWindow.tsx:1012`, `:1155`: launching the action unmounts the overlay and saves its now-disconnected trigger; the fallback queries chapter controls that do not exist while the sidebar remains collapsed. Fall back to `chaptersButtonRef` or restore the overlay/trigger, and assert keyboard focus after cancellation.
2. **Some explicitly named icon controls still have no shared tooltip.** `TitleBar.tsx:83`–`:88` system buttons and `ChapterSearch.tsx:108`–`:125` previous/next buttons have accessible names but no Tooltip. This is a small coverage gap against spec §6's system/search inventory; wrap these controls without replacing their accessible names.

## Deferred-minor and ruling disposition

Every ledger deferral/ruling was considered, including inherited work:

| Ledger item | Disposition |
| --- | --- |
| Task 7 missing stopPropagation on Zen | Still nonblocking by itself: no conflicting binding demonstrated. Central layer handling in Important 3 should use deliberate consumption. |
| Task 7 Zen menu order/comment | Obsolete as a correctness concern: the final menu was rebuilt and no spec fixes its position. No required comment-only change. |
| Task 7 metadata not a true modal | Accepted for metadata: it remains mounted and its draft survives Zen. This does not exempt the actual Diagnostics modal or excuse sidebar draft destruction. |
| Task 8 abandoned auth/rate-limit attempts and NUL reset | Historical process decisions; accepted. Final implementation is text and reviewed independently of discarded work. |
| Task 8 chapter reset tested through remount | Accepted for current ownership: chapter switches explicitly clear snapshot and remount search. No new prop-transition harness required. |
| Task 8 DOM search selection guard/propagation | Nonblocking in current source/comparison views: mousedown releases ownership of the selection; no extra conflicting listener was demonstrated. |
| Task 8 doc-length clamp | Resolved in the final search-highlight implementation. |
| Task 9 empty-book edge case and test-count arithmetic | Empty-book regression was added; arithmetic was explained by parameterization. Closed; no rerun requested. |
| Task 10 rich record-preview remains separate | Accepted documented scope interpretation: rich interactive record previews differ from passive label tooltips and use UI typography. Does not waive bounds for the new shared tooltip (Important 5). |
| Task 10 preview Escape can leave another Tooltip visible | Remains a low-impact residual; it clears on blur/mouseleave/scroll. May be cleaned up with Important 3, but not a separate merge blocker. |
| Task 10 no controller unit tests | Accepted: native timer/focus/Escape coverage exists. Add targeted behavior tests for actual defects rather than mirror implementation. |
| Task 10 no TooltipHost during loading | Accepted: no tooltip triggers render in that branch. No comment needed. |
| Task 2 service inspect/verify instead of artificial modification | Accepted: generic management path preserves session and safety behavior; reorder-specific regression supplies evidence. |
| Task 4 outside-click overlay refocus | Nonblocking under explicit spec return-focus wording. It can steal focus from a clicked input; when addressing layers, distinguish explicit dismiss from interacting with another focusable target. |
| Task 5 control-drag and exhaustive compact-control coverage | Residual validation limits, not demonstrated product defects. Native free-area movement, no-drag double-click assertions, and matrix evidence exist. Add geometry assertions during relevant chrome work; do not represent macOS as validated. |
| Task 6 typo/baseline/read-only/failure paths | Fixed per code and focused evidence; no remaining finding on those specific fixes. |
| Task 11 visualRecord trimming for insertion summaries | Accepted: presentation-only normalization preserves schema and record identity. |
| Task 12 persisted anchor plus in-memory topOffset | Accepted documented compatibility tradeoff. Restart within one line is supported by recorded regression; exact sub-line persistence is not claimed. |
| Task 12 bounded local mapping/no new dependency | Accepted: limits are explicit, unique unchanged lines retained, repeated/UTF-16/boundary cases covered. General editor snapshot/Undo algorithms remain unchanged. |
| Task 12 navigation and multiple queued edits | Prior fixes are present and scoped appropriately; no new concrete ticket/rebase defect established. |
| Task 13 real-copy evidence correction | Accepted: final script adds behavioral assertions and source hashes. However the stored chapter-menu screenshot independently reveals Important 1; a screenshot artifact is not automatically a visual pass. |

## Spec compliance and assessment

**Spec compliance: substantial implementation, but incomplete.** Contextual management, sorting, global layout persistence, unified chrome, guarded metadata editing, search/folder parity, viewport mapping, dense review, and atomic Undo evidence are present. Outstanding issues violate usable contextual menus, layout-safe metadata, single-layer Escape/modal behavior, preservation of unfinished forms, and viewport-bounded previews. macOS and system IME acceptance remain explicitly not run; the deferred macOS selection failure remains open.

**Ready to merge? With fixes — not ready at this head.** Address the five Important findings and run targeted cross-feature regressions in isolated Xvfb/Openbox. Existing green gates support the core storage/editor work, but they do not override the visible clipping defect and state/layer ownership gaps. Minor items can be deferred explicitly.
