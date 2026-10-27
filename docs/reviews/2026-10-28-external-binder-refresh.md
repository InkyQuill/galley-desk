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

The PR branch starts from remote `main`. A subsequent documentation review retained and refreshed useful local design records and the current agent guide; see [documentation review](2026-10-28-retained-documentation.md). No release or installation was performed.
