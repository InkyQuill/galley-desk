# Task 2 report: explicit chapter reordering

## Implemented

- Added `reorder` to the storage and desktop `BookChange` unions and strict IPC validation for a non-empty string ID list.
- Storage accepts only a complete permutation of the current chapter IDs, preserves every chapter wire object (including unknown fields and missing chapters), validates manifest freshness before all work, and skips the write for an already-current order only after that freshness check.
- Added stable natural `ru`/`en` sorting by path or title with numeric comparison and path fallback for an empty title.
- Added the table-of-contents sort action, key selection, preview of every chapter, explicit whole-book warning when a filter is active, and Apply/Cancel controls.
- Reordering leaves Markdown, sidecars, mounted sessions, the active chapter, and input Undo history intact.

## TDD evidence

RED:

```text
npx vitest run packages/book-storage/src/management.test.ts apps/desktop/src/main/ipc.test.ts apps/desktop/src/renderer/book/chapter-order.test.ts
Test Files 3 failed (3)
Tests 3 failed | 39 passed (42)
```

Expected failures were: missing `chapter-order` module, IPC rejecting the new operation, and storage treating reorder as the existing chapter removal branch.

GREEN:

```text
npx vitest run packages/book-storage/src/management.test.ts apps/desktop/src/main/ipc.test.ts apps/desktop/src/main/book-service.test.ts apps/desktop/src/renderer/book/chapter-order.test.ts
Test Files 4 passed (4)
Tests 102 passed (102)
```

## Verification

- `npx tsc -b --pretty false` — passed with no output.
- `npm run package` — passed; Electron Forge packaged the Linux x64 application.
- Native scenario (fresh Xvfb display and its own Openbox):

```text
env -u DISPLAY -u XAUTHORITY -u WAYLAND_DISPLAY \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a sh -c 'openbox >/tmp/galley-task2-openbox.log 2>&1 & obpid=$!; trap "kill $obpid 2>/dev/null || true" EXIT; npm run test:desktop -- tests/desktop/book-management.spec.ts --workers=1 --grep "chapter sorting"'
1 passed (1.4s)
```

The native test activates a chapter, types a pending edit, filters the table of contents, verifies full-spine preview and cancel-without-write, applies natural sorting, checks the complete manifest order and exact Markdown/sidecar bytes, checks the active chapter and Undo, then closes and reopens the book and checks the persisted order.

An initial native launch without the established DBus runtime variables crashed Electron before the scenario ran. The valid run above uses the prior task's isolated environment. A first scenario assertion also sent Undo while focus was on the restored sort trigger; focusing the mounted editor made the test exercise the intended editor Undo path.

## Files changed

- `packages/book-storage/src/book.ts`
- `packages/book-storage/src/management.test.ts`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/ipc.test.ts`
- `apps/desktop/src/main/book-service.test.ts`
- `apps/desktop/src/renderer/book/chapter-order.ts`
- `apps/desktop/src/renderer/book/chapter-order.test.ts`
- `apps/desktop/src/renderer/book/ChapterSidebar.tsx`
- `apps/desktop/src/renderer/book/ChapterDialogs.tsx`
- `apps/desktop/src/renderer/app.css`
- `tests/desktop/book-management.spec.ts`

## Self-review

Reviewed the complete diff and ran `git diff --check`. The reorder branch is deliberately before the remove/trash branch, maps the original wire chapter records by ID, and performs no chapter-session map mutation in the service. No plan or progress ledger edits are included. No unresolved concerns.
