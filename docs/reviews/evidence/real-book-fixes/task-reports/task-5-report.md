# Task 5 — Book and chapter management

## Implementation

- Added bounded storage `manageBook` author commands (rename/create/add/remove/trash) and direct-folder `discoverChapters`. Storage serializes manifest changes per root, checks exact bytes read at open before changes, validates the resulting manifest, preserves v1/v2 wire version, existing chapter objects/IDs/order, compatible unknown fields and ignored files. No identity registry or app-specific manifest fields.
- Creation uses exclusive file creation and produces an H1. Existing sources/sidecars are never overwritten by creation. On manifest-save failure, a newly created file remains recoverable/discoverable for explicit addition.
- Discovery lists only direct-child ordinary nonhidden Markdown not in the spine/ignored list. Adding is explicit and appends selected files in selection order. Valid canonical/legacy sidecars retain their chapter UUID; malformed/mismatched, duplicate IDs, ambiguous sidecars, colliding review names and unsafe/symlink paths are rejected before manifest mutation.
- Remove-from-book preserves source and sidecar; no ignored entry is invented. Trash validates source/sidecar association first, invokes injected Electron `shell.trashItem`, then removes the manifest entry only after every present file moved. Failure reports moved/remaining names, retains the entry and reconciles the UI; recovery uses system trash. No transaction/rollback framework.
- Main service drains pending chapter writes, refuses failed saves/unresolved recovery/external-conflict state, retires affected cached sessions before remove/trash, blocks concurrent management and saves, and updates recent-book titles. Typed IPC validates payloads and uses existing trusted sender + renderer flush/resume gates; preload exposes only the two explicit methods.
- Added Russian, keyboard-accessible native modal management UI, reached through the existing icon menu. Rename/create/discover/add, explicit refresh and focus refresh, choose any chapter (including missing noncurrent entries), separate removal and in-app trash confirmation/cancel. The native dialog prevents background edits. Current chapter selection/snapshots reconcile after mutations, including removing the last chapter and re-adding it. Source-derived titles from Task4 are retained.

## TDD evidence

RED before storage implementation:
`npx vitest run packages/book-storage/src/management.test.ts`
→ **6 failed**: `discoverChapters is not a function`, `manageBook is not a function`. Cases assert v1/v2 preservation/order/ignored/discovery, remove→reopen→readd sidecar identity, unsafe/ambiguous/duplicate additions, external manifest conflicts/exclusive create, and injected second-file trash failure.

GREEN after storage implementation: same command → **6 passed**. Additional trash association/symlink/success case later added; final storage management count **7**.

RED before service implementation:
`npx vitest run apps/desktop/src/main/book-service.test.ts`
→ **42 passed, 2 failed**, both `service.manageBook is not a function`. New cases verify saved edits across remove/readd, renamed recents, and external manifest conflict.

GREEN after implementation:
`npx vitest run packages/book-storage/src/management.test.ts apps/desktop/src/main/book-service.test.ts`
→ **50 passed**.

Final affected unit run:
`npx vitest run packages/book-storage/src/book.test.ts packages/book-storage/src/management.test.ts apps/desktop/src/main/book-service.test.ts apps/desktop/src/main/ipc.test.ts`
→ **4 files, 99 tests passed**. Includes additional failed-save blocking and typed management IPC validation; no failures/warnings.

`npm run typecheck` → passed.
`git diff --check` → passed.
`npm run package` → passed (fresh main/preload/renderer and Linux x64 package). Actual executable exists and was launched, not merely stat-checked.

## Electron and packaged verification

`env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR -u ELECTRON_TRASH XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/book-management.spec.ts --workers=1`
→ **1 passed (2.4s)**. Full scenario: actual typing and signal, rename/recents, remove/readd original identity+review bytes, close/reopen with edit and signal intact, create, discover files appearing while open, ordered explicit add, cancel destructive confirmation, injected first-trash failure retains spine, restore actual shell method and successfully trash source+sidecar, remove a missing noncurrent chapter. No renderer page errors.

`env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR -u ELECTRON_TRASH XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 GALLEY_PACKAGED_EXECUTABLE='/home/inky/Development/galley-desk/apps/desktop/out/Galley Desk-linux-x64/Galley Desk' GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/packaged-management.spec.ts --workers=1`
→ **1 passed (1.5s)**, actual hardened package. Renderer CDP avoids changing the disabled Node-inspector fuse. Seeded a fictional recent book, tested pending input, rename, creation, cancel, real native trash of source+review, and recents. Closed the book before stopping only the spawned fixture process.

Initial native-trash test failures were environmental: `/tmp` is an internal tmpfs mount; Electron reported `Error: Failed to move item to trash`, while controller verified gio stderr `Trashing on system internal mounts is not supported`. Moving disposable book fixtures to `~/.cache/desk-…-test-*` resolved native trash. Final representative KDE6 run has **no ELECTRON_TRASH override**. No fake-success seam remains; the only mock is an intentional failure followed by restoration of the original method. The attempted ordinary Electron launcher for the hardened package was stopped because the Node-inspector fuse disallows its main-process inspector; the dedicated packaged CDP spec passes.

Screenshots inspected: `/tmp/galley-management-compact.png` (620×700, scrollable themed management UI) and `/tmp/galley-packaged-management.png` (packaged UI). Temporary profiles/books only; installed user application and real books untouched.

## Files owned

- `packages/book-storage/src/book.ts`, `index.ts`, new `management.test.ts`
- `apps/desktop/src/main/book-service.ts`, `book-service.test.ts`, `ipc.ts`, `ipc.test.ts`, `main.ts`
- `apps/desktop/src/shared/api.ts`, `preload/index.ts`
- `apps/desktop/src/renderer/book/BookWindow.tsx`, new `BookManagement.tsx`, `renderer/app.css`
- `tests/desktop/book-management.spec.ts`, `packaged-management.spec.ts`

Root's README/docs, untracked assets/ADR/design inspiration remain unstaged and preserved.

## Self-review and limits

- Found and fixed empty-spine→readd selection and missing-noncurrent-chapter management access before final verification.
- Explicit file operations are not a cross-file atomic transaction. Partial trash retains the manifest entry and names moved/remaining files; system trash can recover moved files. Creation followed by manifest failure leaves the new file for explicit discovery. External manifest changes are rejected and require close/reopen rather than merging or overwriting.
- Existing `book.ts` and `BookWindow.tsx` are large; added bounded functions/component without unrelated restructuring.
- Full repository suite and performance budget remain controller-owned. Packaged spec intentionally skips unless `GALLEY_PACKAGED_EXECUTABLE` is supplied, as in the release runbook.

Final baseline-environment integration check (without added XDG/DBus overrides):
`env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/book-management.spec.ts tests/desktop/metadata.spec.ts --workers=1`
→ **2 passed (3.8s)**, including Task4 metadata regression. Final typecheck and diff whitespace check passed. Last changes after package were formatting and test additions only; executable behavior had been tested from the current implementation.

Commit: `b20a311` — `feat: manage book titles chapters and recoverable file removal`.
Status: DONE. Build/GUI slot released; no task test or package process remains running.

## Review fix round 1 — failed management session continuity

Base: `b20a311`. Reviewer P1 confirmed. The service retired the chapter session before storage validation or trash succeeded, clearing undo and resetting revisions during reconciliation. A manifest conflict could prevent reconciliation entirely and leave subsequent input with `BOOK_MISSING`.

Fix:
- Keep the exact live session, revision and undo history through all validation, unavailable-trash and first-trash refusals. Retire the session only after successful remove/trash.
- Storage `BookManagementError.filesMoved` explicitly distinguishes a failure after a successful trash move from a refusal that changed no files, including failures saving the manifest after trash. This stays a small error contract, not a transaction framework.
- Only partial trash reconstructs the affected chapter from actual remaining files. Its revision is the previous revision plus one, and the service pushes that snapshot. Existing React/CodeMirror stale-snapshot guards remain unchanged.

RED evidence:
- `npx vitest run apps/desktop/src/main/book-service.test.ts -t 'failed .* preserves a live'` → **2 failed** with `IpcError: Глава ещё не открыта` when typing directly into the still-mounted session after failed trash/manifest removal.
- `npx vitest run apps/desktop/src/main/book-service.test.ts -t 'partial trash replaces'` → **1 failed**, `expected 1 to be greater than 5`.
- `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/book-management.spec.ts -g 'failed management' --workers=1` → **2 failed** on the old build. Failed trash lost the undo entries created before the failure (`xxxxAlpha body` instead of `xxxAlpha body`); manifest-conflict removal prevented continued typing (`xxxxAlpha body` instead of `yxxxxAlpha body`).

GREEN evidence:
- `npx vitest run apps/desktop/src/main/book-service.test.ts packages/book-storage/src/management.test.ts` → **55 passed**. New tests verify direct continued typing without reopening, undo of new input and an earlier pre-failure edit, partial-trash strictly increasing revision, missing-source read-only snapshot push and retained spine.
- `npm run typecheck` → passed.
- `npm run package` → passed, fresh main/preload/renderer and executable.
- `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/book-management.spec.ts --workers=1` → **3 passed (4.4s)**. Includes the full native management flow plus both mounted-editor failure regressions; checks persisted text and rendered content after typing and both undo steps.
- `git diff --check` → passed.

Changed paths: `packages/book-storage/src/book.ts`, `apps/desktop/src/main/book-service.ts`, `apps/desktop/src/main/book-service.test.ts`, `tests/desktop/book-management.spec.ts`. No stale-snapshot guard suppression, source-schema changes or unrelated edits. The existing full-suite scope stays controller-owned. Temporary regression processes only were stopped during RED cleanup; installed app untouched.

Round 1 commit: `ea8bb86` — `fix: preserve chapter sessions when book management fails`.
Round 1 status: DONE. Build/GUI slot released; no pending test/build process.
