# Combined final fix wave

Status: DONE. Commit: `48246d4 fix(desktop): restore typing budget and final native regressions`. Base: ce617d9, branch codex/desk-real-book-fixes. GUI/build slot released.

## Implemented

- Snapshot source text/title uses a weak cache keyed by the engine's immutable source bytes. Suggestions reuse the source; metadata save, external reload, apply and undo replace it. Manifest/filename fallbacks are evaluated on every request. BOM/raw source remains exact; title parsing retains the previous BOM normalization.
- Protected frontmatter keeps its boundary in CM state, checks only the first line for chapters without frontmatter, and recalculates after prefix/source changes. Body typing does not flatten/reparse unchanged metadata. Unterminated metadata still consumes appended text until repaired.
- Native CPU profiling identified the review gutter as a larger renderer hotspot than metadata: filtering 500 records for each line and rebuilding all marker DOM on shifted positions. Gutter lookup now shares a weak sorted index and uses binary lower-bound lookup. Marker equality compares DOM-affecting payload fields; geometry resolves positions from the current record map and refreshes its observable position attribute. Click and hover handlers already resolve current records by ID, so reused DOM carries no stale record closures.
- Book management publishes its authoritative BookView to App. Rename immediately refreshes both visible headers; the existing recents/reopen assertions remain.
- Linux X11 tests are explicitly Linux-only. CI installs Xvfb/Openbox/xdotool/xprop (x11-utils), runs Openbox inside Xvfb, and cleans it up. Linux requirements are not skipped. The frame screenshot uses testInfo.outputPath. The pending-close test uses BrowserWindow.close on macOS and the custom control elsewhere.
- Updated the five stale native test assumptions: TOC title + filename accessible names, Russian warning icon label, management as first book-menu item, and a real ArrowLeft into the changed range before checking passive preview typography/focus. Once the chapter-switch test reached its final assertion, its restored end caret required explicitly revealing the virtualized beginning; full exact text/sidecar assertions remain intact.

## RED and diagnosis

All commands below ran from `/home/inky/Development/galley-desk`.
GUI prefix used (all native invocations):

```sh
env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module [extra env below] xvfb-run -a /tmp/galley-with-openbox.sh [command]
```

The wrapper starts/stops only its own Openbox inside its own Xvfb. Later native commands set:
`GALLEY_PACKAGED_EXECUTABLE='/home/inky/Development/galley-desk/apps/desktop/out/Galley Desk-linux-x64/Galley Desk'`.

- `GALLEY_PERF=1 GALLEY_PROFILE=1` + `npx playwright test tests/desktop/performance.spec.ts --workers=1`: RED p95 **75.7 ms**, versus unchanged 50 ms budget. Prior controller unprofiled result was 70.2 ms. Diagnostic JSON and CPU profile are retained before budget assertions.
- CPU self-time across the measured typing/save phase: original gutter filter anonymous callback about 349 ms, lineMarker 231 ms, gutter toDOM 172 ms. The first optimization reduced profiled p95 to 51.6 ms, still RED. Its remaining gutter DOM self-time was 96.6 ms, prompting reuse across shifted anchors with live position lookup. These are sampling observations, not exact attribution of each input's latency.
- `npx playwright test tests/desktop/book-management.spec.ts -g 'book management:' --workers=1`: new header assertion failed with old titlebar text while the book heading already displayed `Renamed book`.
- `npm test -- apps/desktop/src/shared/metadata.test.ts apps/desktop/src/renderer/editor/frontmatter.test.ts`: 9 passed / 1 expected failure (`sourceMetadata is not a function`) before implementing the cache helper.

## GREEN validation

- `npm run package`: succeeded after final production change. `test -x 'apps/desktop/out/Galley Desk-linux-x64/Galley Desk'`: succeeded. Build and native tests never overlapped.
- `npm run typecheck`: passed.
- `npm test`: **383 passed, 34 files**. Includes cache parse reuse/invalidation, manifest fallback, metadata replacement boundaries, unterminated metadata, gutter ordering/mapping/authoritative refresh, and service apply/undo title refresh. Existing native metadata test verifies explicit save and external title reload.
- Focused native: `npx playwright test tests/desktop/book-management.spec.ts tests/desktop/close-pending.spec.ts tests/desktop/window-frame.spec.ts tests/desktop/metadata.spec.ts tests/desktop/edit-and-reopen.spec.ts tests/desktop/review-actions.spec.ts tests/desktop/external-change.spec.ts tests/desktop/search-and-appearance.spec.ts --workers=1`: 45 passed / 2 failed. The two subsequent fixes were the restored virtualized chapter start and the live gutter position attribute described above.
- Focused follow-up: `npx playwright test tests/desktop/edit-and-reopen.spec.ts tests/desktop/review-actions.spec.ts -g 'смена главы во время|delayed ACK maps' --workers=1`: **2 passed**. No assertions removed.
- Final isolated performance: `GALLEY_PERF=1` + `npx playwright test tests/desktop/performance.spec.ts --workers=1`: **1 passed**, after the final gutter position update; no profiler or heavy concurrent work. **p95 40.7 ms, median 33.8 ms, max 41.7 ms; chapter open 1123 ms, book open 549 ms.** Unchanged budgets: 50 ms typing / 2000 ms chapter open. Fixture unchanged: 100 chapters, 1,048,645 source bytes, 500 records, 24 inputs. Exact sidecar reconstruction, unchanged source and reopened text are verified. Main RSS 435,269,632 bytes; renderer heap 56,800,000 bytes. Confirmed-save p95 1010.4 ms includes host dispatch, sidecar polling and UI saved acknowledgement; it is not physical fsync timing.
- Full native: GUI prefix + `npm run test:desktop`: **67 passed / 1 expected performance skip, all 68 cases, 2.0 minutes**. Packaged smoke and both required Linux window checks passed. No native failure or unexpected skip remains.
- `git diff --check`: passed.

## Evidence

All evidence is preserved under `.superpowers/sdd/2026-09-16-real-book-fixes/final-evidence/`, outside Playwright's resettable test-results:

- `performance-before.json`, `typing-before.cpuprofile`
- `performance-intermediate.json`, `typing-intermediate.cpuprofile`
- `performance-final.json` (first successful optimization run)
- `performance-final-verified.json` (final production code)
- `galley-final-*.log`: exact RED/GREEN, package, units/typecheck, focused/full native and performance logs
- `focused-failures/`: intermediate native error contexts

## Changed paths and self-review

Production: `apps/desktop/src/main/book-service.ts`; `apps/desktop/src/shared/metadata.ts`; `apps/desktop/src/renderer/App.tsx`; `apps/desktop/src/renderer/book/BookWindow.tsx`; `apps/desktop/src/renderer/editor/frontmatter.ts`; `apps/desktop/src/renderer/editor/markers.ts`.

Tests: the corresponding main/shared/frontmatter/markers unit files; desktop book-management, close-pending, edit-and-reopen, external-change, performance, review-actions, search-and-appearance, window-frame specs. CI: `.github/workflows/desktop.yml`.

Self-review caught and covered the unterminated-frontmatter EOF case. Marker DOM equality excludes position deliberately; current-state geometry updates it, and delayed-ACK tests verify both before/after-ack positions. Existing wrapped-row, hover, popup, signal edit, typography, viewport, source-byte and save-order assertions are retained.

No Pocket/GalleyEditor/Pad changes, dependency upgrades, user-book access, installed-app termination, push, merge or installation. Controller documentation edits and untracked inspiration/light/dark artifacts are preserved and excluded from this commit. Performance results describe this Linux host. macOS CI handling is prepared but no macOS runtime execution is claimed. Contract/security/install closure remains with the controller as assigned.
