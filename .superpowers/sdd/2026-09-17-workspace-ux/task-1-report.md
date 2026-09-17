# Task 1 implementation report

## Implemented

- Replaced the universal `BookManagement` dialog with contextual table-of-contents actions.
- Added `ChapterSidebar`, `ChapterMenu`, `ChapterDialogs`, and `RenameBookDialog`.
- Kept chapter filtering through the existing `matchesChapter` helper.
- Added header actions for chapter creation and current-folder discovery using the shared `Tooltip`; no enabled sort control was added because Task 2 owns sorting.
- Added adjacent, keyboard-accessible per-chapter menus with explicit target IDs. Missing chapters retain their removal menu while their open button remains disabled.
- Preserved the existing `flushPending -> manageBook -> refreshBook` sequence, failed-management state, partial-trash refresh, UUID/sidecar behavior, trash confirmation, and editor Undo behavior.
- Discovery loads only when its dialog opens, refreshes on explicit request and window focus while open, and adds only checked files.
- Moved book rename into its own book-menu dialog; retained Appearance, Zen, Diagnostics, and Close in the book menu.
- Removed the old management selector and universal-dialog CSS. Updated native selectors that distinguish chapter-open buttons from adjacent chapter-action buttons.
- Restored focus to the initiating control when it survives, otherwise to the active/nearest chapter menu or table-of-contents header action.

## TDD evidence

### RED

Command (isolated virtual X11 display with its own Openbox):

```sh
env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a sh -c 'openbox >/tmp/galley-task1-red-openbox.log 2>&1 & obpid=$!; trap "kill $obpid 2>/dev/null || true" EXIT; npm run test:desktop -- tests/desktop/book-management.spec.ts --workers=1 --grep "book management: rename"'
```

Relevant expected failure after packaging the baseline:

```text
TimeoutError: locator.click: Timeout 30000ms exceeded.
waiting for getByRole('button', { name: 'Переименовать книгу', exact: true })
1 failed
```

This failed because the old book menu exposed only `Управление книгой`; the new contextual rename control did not exist. An earlier runner attempt failed before exercising the test because the worktree lacked `.vite/build/main.js`; packaging fixed that prerequisite. A second attempt without the established DBus runtime variables caused Electron startup failure; all valid RED/GREEN evidence uses isolated `xvfb-run` plus its own Openbox and explicitly removes inherited Wayland/Xauthority state.

### GREEN

Final native command (explicitly removes inherited desktop display state, then creates a dedicated Xvfb display and Openbox):

```sh
env -u DISPLAY -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk" \
  xvfb-run -a sh -c 'openbox >/tmp/galley-task1-final2-openbox.log 2>&1 & obpid=$!; trap "kill $obpid 2>/dev/null || true" EXIT; npm run test:desktop -- tests/desktop/book-management.spec.ts tests/desktop/packaged-management.spec.ts tests/desktop/search-and-appearance.spec.ts --workers=1'
```

The three management tests and packaged-management test passed. The run exposed only stale fuzzy chapter selectors in the broader search/appearance spec; those selectors were tightened to exact open-button names. After correcting the final inferred-filename expectation, the focused isolated regression passed:

```text
1 passed (1.2s)
```

The immediately preceding full run was 14/15 passing, with that one selector-only failure. The named management acceptance set was 4/4 passing in both the earlier dedicated run and the final broader run.

## Other verification

- `npm test`: 33 files, 431 tests passed.
- `npm run typecheck`: passed with no diagnostics.
- `npm run package`: passed; Linux x64 executable created.
- `npm test -- --run apps/desktop/src/renderer/book/chapter-filter.test.ts`: 7/7 passed.
- `git diff --check`: passed.

## Files changed

- `apps/desktop/src/renderer/book/ChapterSidebar.tsx` (new)
- `apps/desktop/src/renderer/book/ChapterMenu.tsx` (new)
- `apps/desktop/src/renderer/book/ChapterDialogs.tsx` (new)
- `apps/desktop/src/renderer/book/RenameBookDialog.tsx` (new)
- `apps/desktop/src/renderer/book/BookWindow.tsx`
- `apps/desktop/src/renderer/book/BookManagement.tsx` (removed)
- `apps/desktop/src/renderer/app.css`
- `tests/desktop/book-management.spec.ts`
- `tests/desktop/packaged-management.spec.ts`
- `tests/desktop/search-and-appearance.spec.ts`

## Self-review

- Confirmed per-row action menus use their entry ID rather than `activeId`.
- Confirmed menu buttons are siblings of chapter-open buttons and remain visibly distinct on the active row; hover/focus reveals them elsewhere.
- Confirmed missing entries cannot open but can be removed.
- Confirmed no sort control is exposed before Task 2 supplies working behavior.
- Confirmed existing Diagnostics and Zen paths remain wired and modal dialogs block the Zen shortcut.
- Confirmed all Electron execution used a dedicated Xvfb/Openbox session and never inherited or addressed the user's desktop.

## Concerns

- Native macOS execution was unavailable; Linux X11 and the packaged Linux executable were verified.
- The final all-three-spec run recorded 14/15 before the last test-only selector correction; that corrected filter test then passed in isolation. The requested two management specs themselves passed completely after the final production build.

## Review fix round 1

The review found that a trash action closed its submenu before `BookWindow`
captured `document.activeElement`. The stored element was therefore the removed
submenu item, and cancelling trash on a non-active chapter fell back to the
active row instead of returning to the initiating row.

The chapter row menu button now carries its chapter ID. `BookWindow` resolves
and stores that persistent button from the action's explicit `chapterId` before
opening the dialog. Cancellation focuses the surviving initiating button;
successful removal still uses the existing active/nearest/header fallback.

### RED

```sh
env -u DISPLAY -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a sh -c 'openbox >/tmp/galley-task1-fix1-red-openbox.log 2>&1 & obpid=$!; trap "kill $obpid 2>/dev/null || true" EXIT; npm run test:desktop -- tests/desktop/book-management.spec.ts --workers=1 --grep "book management: rename"'
```

Expected failure from the new focus assertion:

```text
expect(locator).toBeFocused() failed
Locator: Действия главы: a
Expected: focused
Received: inactive
1 failed
```

### GREEN

The same focused command passed after the fix:

```text
1 passed (3.1s)
```

Final combined verification, also isolated under a fresh `xvfb-run` display
with its own Openbox and the packaged executable supplied:

```sh
env -u DISPLAY -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk" \
  xvfb-run -a sh -c 'openbox >/tmp/galley-task1-fix1-combined-openbox.log 2>&1 & obpid=$!; trap "kill $obpid 2>/dev/null || true" EXIT; npm run test:desktop -- tests/desktop/book-management.spec.ts tests/desktop/packaged-management.spec.ts tests/desktop/search-and-appearance.spec.ts --workers=1'
```

```text
15 passed (15.8s)
```

`npm run typecheck` and `npm run package` also passed before the native GREEN
runs. This combined rerun supersedes the earlier 14/15 evidence limitation.
