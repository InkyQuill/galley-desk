# Final scoped fix-wave re-review

Reviewed `e6cfabe..ec589b0` against `final-review.md`, `final-fix-report.md`, the supplied review diff, global constraints and the Workspace UX specification. This is the single scoped re-review, not another whole-branch review. Read-only except this report; no tests, native sessions or subagents were run.

## Disposition

| Original finding | Verdict | Rationale |
| --- | --- | --- |
| Important 1 — chapter menu clipping | **ADDRESSED** | `AnchoredLayer` portals fixed content directly under the themed `.app-root`, removing both clipping ancestors. It measures the trigger, clamps horizontal placement and bounds available vertical height, updating on resize/scroll. Menu focus moves inside the portal; React event ancestry retains its local Escape handler. Portal-aware outside-click checks preserve action clicks within the sidebar overlay. New assertions check both menu-button rectangles and painted centers, plus zero sidebar horizontal scroll; capture covers first/last rows and narrow overlay. The viewed narrow-overlay image shows both readable actions outside the sidebar without clipping. |
| Important 2 — unsaved chapter note loss | **ADDRESSED** | `BookWindow` now owns draft/open/error/busy state keyed by chapter, above inline/overlay/Zen branches. Partial updates use functional state merging, and asynchronous callbacks retain their chapter-specific updater. Presentation unmounts no longer erase the note or imply a save. Regression explicitly traverses hide/show, collapse/overlay/expand and Zen with draft and injected save-error state, and checks the draft did not reach the sidecar. |
| Important 3 — Escape ownership / Diagnostics | **NOT ADDRESSED** (partial fix; one concrete residual) | Native dialogs and metadata now get Escape before workspace dismissal; Diagnostics blocks the Zen shortcut through the native-dialog guard. Search+clean/dirty metadata, search+chapter dialog and note-in-overlay cases have meaningful assertions. However the new chapter-menu deferral also claims Escape after that menu has closed, preventing the next outer-layer dismissal. See scoped finding below. |
| Important 4 — metadata clipping | **ADDRESSED** | Metadata uses the same unclipped themed fixed layer, right alignment, horizontal clamp and actual-top-based scroll height. Portal padding is included in inside-click recognition. Existing metadata tests assert editable/read-only focus, restore, dirty/saving guards, stale-source protection and save behavior. New geometry checks cover 1100/900 px; real-copy capture includes long YAML, discard and 125% zoom. The viewed 900px/125% discard image has the full prompt and both controls inside the viewport. |
| Important 5 — oversized shared tooltips | **ADDRESSED** | CSS adds viewport-relative max-height, hidden overflow and arbitrary-token wrapping. The regression combines a 3000-character unbroken token with 150 lines at 125%, checks all four bounds, no horizontal scroll overflow and actual clipping, then verifies the complete original comment in the click-open record card. This tests the specific overflow failure rather than locator visibility alone. |
| Minor 1 — disconnected dialog focus target | **ADDRESSED** | Chapter-dialog close falls back to the connected chapter-toggle ref when the saved trigger and sidebar controls are unavailable. The new native cancellation case asserts focus on that toggle with underlying search preserved. |
| Minor 2 — icon tooltip inventory | **ADDRESSED** | Minimize, maximize/restore, close, previous and next match now use the shared Tooltip while retaining button accessible names. This small wiring change is directly inspectable; the existing shared-controller native coverage supports the behavior, although no new inventory-specific hover assertion was added. |

## Scoped remaining finding

**[P2 / Important] Only defer Escape to an actually open chapter menu.**

Location: `apps/desktop/src/renderer/book/BookWindow.tsx:452`, interacting with `apps/desktop/src/renderer/book/ChapterSidebar.tsx:51`.

At 700px, open the chapter overlay, open a chapter action menu, then press Escape twice. The first Escape closes the menu and restores focus to its `.book__chapter-menu-button`, as intended. The second reaches the new unconditional `.closest('.book__chapter-menu, ...')` guard on window capture, so workspace dismissal returns early even though `menuId` is now null. The existing row handler then consumes Escape and focuses the same button again. Further Escapes leave the overlay open. The same restored focus prevents closing underlying search in the inline-sidebar case. This is a concrete regression caused by the fix's new guard, within the original ownership finding's scope.

Make window deferral conditional on that row's menu being open (or scope it to actual portaled menu content and an expanded trigger), and consume local Escape only while there is a menu to dismiss. The required regression is menu → first Escape: menu gone, overlay present → second Escape: overlay gone and toolbar focus restored, with underlying search still present. Add the equivalent inline/search sequence if retaining broad focus-based deferral.

`tests/desktop/workspace-layers.spec.ts:74–82` currently checks the first Escape, then clicks Add Chapter; the native dialog close therefore bypasses the failing second Escape path. `capture.mts:140–143` sends the second Escape but does not assert overlay closure before resizing, which subsequently tears down the overlay. Reported green runs do not disprove this source-traced failure.

## Evidence and remaining limits

The new regression assertions meaningfully cover six completed dispositions and most of Important 3; the precise second-Escape gap is identified above. Reported gates are 104 native passes / one expected performance skip, 461 unit passes, typecheck/package/diff-check PASS. These are accepted as supplied evidence, not independently rerun results. The fix report records refreshed real-copy captures and identical original source hash `55253e0c7ff59af1ccac74ef4cefa6d0df90fd9e5089de58e912f334d5920046`.

No additional concrete production breakage was established within this fix diff. Full macOS and system IME acceptance remain unrun; the deferred macOS selection failure remains unchanged. Note drafts remain in-memory for the current open book, and oversized passive tooltips intentionally clip while the record card exposes full content. Those are declared limits, not new findings. Existing whole-branch deferrals are not reopened here.

**Final status: changes requested for the scoped Escape regression; four Important and both Minor findings addressed, Important 3 partially addressed.** This completes the requested single re-review; no further review or fix wave was initiated.
