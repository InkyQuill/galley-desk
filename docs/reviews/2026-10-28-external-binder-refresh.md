# External binder refresh, chapter discovery and dependency security

## Changes

- Root watcher and window-focus checks now read external binder changes and discover unlisted Markdown files. Refresh never writes or recreates the binder.
- Unchanged chapter identities and paths retain their sessions and undo history. Removed or remapped sessions are retired only after pending storage work is safe. Failed saves and recovery conflicts defer refresh with a notice; invalid or different-book binders do not replace the active book.
- A dismissible notice offers the existing chapter-selection dialog. Hidden, ignored, nested and registered files are excluded. Adding chapters remains an explicit action.
- The renderer receives a narrow book-update event. Pending editor work is checked before changing its active book view. Ordinary chapter saves do not trigger whole-book content reads when binder and discovered-file state are unchanged.

## Dependency updates

- Electron: 44.7.0 → 44.10.0, retaining the existing major version.
- fast-uri: 3.1.8 → 3.1.9.
- undici: 6.29.0 → 6.29.1 and 7.30.0 → 7.30.1.
- Transitive updates use existing dependency ranges; no overrides or new dependencies.

## Verification

Verified after installing the synced lockfile with `npm ci`:

- `npm run typecheck`: PASS.
- `npm test`: PASS, 492 tests in 37 files.
- `npm run package`: PASS, Linux x64.
- Full isolated Electron suite with `GALLEY_PACKAGED_EXECUTABLE` set: PASS, 123 tests; opt-in performance test skipped. This includes the actual packaged executable and Pocket returned-folder checks.
- Regression evidence includes exact binder/source/sidecar preservation, active undo after binder refresh, removed/remapped chapters, malformed binder recovery, failed-save draft preservation, discovery exclusions and adding a suggested chapter through the UI.
- `git diff --check`: PASS.
- `npm audit`: PASS, zero vulnerabilities after a clean `npm ci`.
- `npm run check:release`: PASS, version identity and 8 release-tooling tests.
- `npm run test:contracts`: PASS, Kotlin exchange and 21 TypeScript checks against the pinned Pocket revision, with JDK 17 and the installed Android SDK. Pocket wire schemas and fixtures are unchanged.
- macOS native checks: NOT RUN.

The first full desktop run exposed default-profile collisions in the two shell tests; both now use temporary profiles. It also had one long-chapter undo/redo viewport assertion failure. That test passed standalone on Electron 44.7.0 and 44.10.0 and in the final full run; its root cause remains unconfirmed. No retry, timeout or assertion changes were made.

The PR branch starts from remote `main`. A subsequent documentation review retained and refreshed useful local design records and the current agent guide; see [documentation review](2026-10-28-retained-documentation.md). No release or end-user application installation was performed.

## CodeRabbit follow-up

The book-update subscription now lasts for the open book rather than restarting
on editor remounts or book-view updates. A pushed update supersedes a delayed
initial discovery response; newer updates and unsubscription also invalidate
book refreshes still awaiting an editor flush. Three focused regressions cover
response ordering, pending-work invalidation and book/close isolation.

Follow-up validation: typecheck passed; all 495 unit tests in 38 files passed;
Linux x64 packaging passed; all five book-management Electron tests passed
against the rebuilt package under `scripts/gui-test.sh` with one worker.
`git diff --check` passed. The full desktop and contract results above refer
to the earlier runtime revision; those suites were not repeated for this
renderer-only follow-up. macOS remains NOT RUN.

Documentation follow-ups make GUI examples isolated by default, distinguish
end-user application installation from dependency installation, annotate the
historical 900px capture as anomalous without altering its data, and specify
missing-locale migration and round-trip tests in the proposed localization
plan. Localization itself remains unimplemented.

## Merge-gate follow-up

CodeRabbit's final ref-lifecycle finding was fixed by publishing book-update
callback values in a layout effect, after React commits the render.

The subsequent hosted Linux run exposed a review-overlay focus race: its
scheduled frame could move focus away from an already-focused chapter note,
so Escape closed the overlay instead of the note. A controlled frame-delay
regression reproduced the focus theft before the fix. Overlay initialization
now preserves focus within the panel and cancels its pending frame on cleanup.
The regression retains both Escape assertions and the draft-preservation checks.

Validation after the focus fix: typecheck, all 495 unit tests, Linux packaging,
and all eight isolated book-management/workspace-layer Electron tests passed.
No retries, assertion weakening, or timeout increases were introduced.

The outside-diff review also identified stale initial discovery after a local
rename/add/reorder. Local refreshes now invalidate the subscription's pending
initial result and any pushed update waiting for an editor flush. External
updates use the separate apply path. A focused regression verifies that local
changes reject old results while later external pushes still work. Typecheck,
496 unit tests, packaging and the same eight isolated desktop tests passed.
