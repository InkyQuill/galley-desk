# Task 6 report — custom window frame and application icon

## Implemented

- Added a shared application title bar on both the welcome and book screens. It uses the approved canonical colour SVG, remains present in Zen mode, provides a drag region, and marks its controls as non-draggable.
- Added accessible Russian minimize, maximize/restore, and close controls plus title-bar double-click maximize/restore. Native maximize/unmaximize events keep the rendered state synchronized.
- Linux now creates a frameless window and removes Electron's default application menu. This also avoids a native menu accelerator intercepting editor redo. macOS is configured with `hiddenInset`, native traffic lights, and an inset title bar; its application menu remains intact.
- Added only the explicit `desk:window-state` and `desk:window-action` preload methods. They reuse the existing trusted top-frame/origin gate. Arbitrary actions and foreign senders are rejected.
- Close calls `BrowserWindow.close()`, so the existing close event still flushes pending renderer edits and `service.closeAll()` before destruction. It never calls `destroy()` from the control handler.
- Added Linux PNG and multi-representation macOS ICNS derivatives generated from the canonical SVG, Forge executable icon configuration, and packaged branding resources. Added the supplied branding ADR and both canonical SVGs.
- Extended the packaged-app harness with the child PID only, allowing a real isolated X11 window-manager assertion without weakening production fuses.

## TDD evidence

RED:

```text
npx vitest run apps/desktop/src/main/window.test.ts
FAIL Cannot find module './window'
Test Files 1 failed
```

This was expected because the tested platform window options and narrow action dispatcher did not exist.

GREEN:

```text
npx vitest run apps/desktop/src/main/window.test.ts apps/desktop/src/main/ipc.test.ts
Test Files 2 passed (2)
Tests 15 passed (15)
```

The tests cover Linux/macOS window configuration, guarded close via `close()`, maximize toggling, the explicit action vocabulary, and trusted top-frame sender enforcement.

## Verification

- `npm run typecheck` — passed.
- `npm run package` — passed; produced the Linux x64 package.
- `npm run check:security` — completed with 0 parser errors. It reported the same six heuristic findings for the existing CSP/window/openExternal lines; sandbox and context isolation remain enabled in the tested configuration.
- Isolated real-WM command (Openbox was started and stopped only inside Xvfb):

```text
env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a sh -c \
  'openbox >/tmp/galley-desk-task6-openbox.log 2>&1 & obpid=$!; \
   trap "kill $obpid 2>/dev/null || true; wait $obpid 2>/dev/null || true" EXIT; \
   GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/Galley Desk-linux-x64/Galley Desk" \
   npx playwright test tests/desktop/window-frame.spec.ts tests/desktop/close-pending.spec.ts --workers=1'
5 passed (7.0s)
```

  This exercised the hardened packaged executable over renderer CDP, the actual Openbox minimize state through X11, restore, maximize/restore, successful custom-close flush, failed-close retention, and close lifecycle serialization.

- `npx playwright test tests/desktop/edit-and-reopen.spec.ts --workers=1 -g "ввод кот→кит"` in the same isolated Openbox setup — 1 passed; uppercase `ControlOrMeta+Shift+Z` redo still works.
- Final post-build focused rerun: packaged window plus custom-close flush — 2 passed.
- Packaged resources contain a 512×512 RGBA PNG and a valid ICNS container with 16–512 px PNG representations.

Screenshot: `.superpowers/sdd/2026-09-16-real-book-fixes/task-6-window-frame.png` (ignored task evidence, preserved locally). It shows the real packaged Linux window maximized under Openbox with the approved icon and restore state.

## Files changed

- `apps/desktop/src/main/{main,ipc,window}.ts` and focused tests
- `apps/desktop/src/preload/index.ts`, `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/renderer/{App,TitleBar}.tsx`, `app.css`
- `apps/desktop/forge.config.ts`
- `apps/desktop/assets/branding/**`
- `docs/adr/0004-application-icon.md`
- `tests/desktop/{window-frame,close-pending,packaged-app}.ts`

## Self-review and limits

- Reviewed the complete scoped diff and ran `git diff --check`; no whitespace errors.
- The application icon geometry was not redrawn; all derivatives came from the supplied canonical SVG.
- macOS configuration and ICNS structure were prepared on Linux. No macOS runtime or Dock test was claimed.
- The screenshot uses Xvfb's compact virtual screen; compact layout and controls remain usable.

## Fix round 1 — scrollable compact welcome

Review found that the fixed-height application root clipped a long recent-books list: scrolling the last item into view moved the custom title bar off-screen and made the top unreachable. The fix gives only the welcome content wrapper its own scroll container and lets the welcome grid grow from a `safe center`; book/editor scrolling is unchanged.

RED:

```text
GALLEY_PACKAGED_EXECUTABLE="…/Galley Desk" npx playwright test \
  tests/desktop/window-frame.spec.ts --workers=1 -g "compact welcome"
FAIL compact welcome keeps every recent book reachable below the fixed title bar
Expected titlebar y: 0; received: -1365
1 failed
```

GREEN, after rebuilding the real package:

```text
GALLEY_PACKAGED_EXECUTABLE="…/Galley Desk" npx playwright test \
  tests/desktop/window-frame.spec.ts --workers=1
2 passed (16.4s)
```

The native regression resizes the packaged Openbox window to 720×520, supplies 30 recent entries with long paths, scrolls to the last and back to the first, and checks that both become visible while the title bar stays at the same screen position. `npm run typecheck`, `npm run package`, and `git diff --check` also pass for the fix.
