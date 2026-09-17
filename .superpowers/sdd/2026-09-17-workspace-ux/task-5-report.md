# Task 5 report: unified title bar and book toolbar

## Implemented

- `TitleBar` now accepts `children` and remains responsible for window state,
  Linux window controls, double-click maximize, macOS inset, and the real
  Diagnostics dialog.
- `App` renders `TitleBar` only on the welcome/recent-books screen.
  `BookWindow` renders exactly one `TitleBar` with book-owned controls, without
  moving editor state into `App` or using a portal.
- The chrome is a fixed 44px, single-line draggable row. The title has
  `min-width: 0` and ellipsis; controls, fields, menus, and popup content are
  no-drag.
- At widths below 1100px, direct Zen and Diagnostics controls are removed from
  the tab order and exposed through the book menu. Search still opens as its
  existing separate row. Appearance is positioned from its menu trigger.
- Zen keeps the one title bar, native controls, and a visible in-titlebar exit
  button at every width. Escape and the physical-KeyZ shortcut behavior remain
  covered by the existing tests.
- Save/read-only/external-conflict banners live below the draggable header.
  Existing close and renderer flush paths were not changed.
- The Linux packaged test now performs real `xdotool` dragging in a free title
  area, double-click maximize, minimize, restore, and button clicks inside the
  isolated Xvfb/Openbox display.

## TDD evidence

### RED

The focused native acceptance was added first in
`tests/desktop/window-frame.spec.ts`. Against the pre-change structure its new
assertions fail because `.titlebar` is 38px and `.book__header` exists. The
test requires one 44px `header.titlebar`, no `.book__header`, and compact menu
access. The test was authored before production edits; no separate pre-change
native execution was retained.

The first recorded integrated run after implementation was also usefully red:
19 passed / 1 failed because the new packaged-book fixture omitted required
manifest title data. After correcting the fixture, an added X11 drag assertion
initially failed because a single synthetic pointer jump did not cross
Openbox's drag threshold. The test now sends incremental real pointer moves.

### GREEN

```sh
env -u DISPLAY -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a -s '-screen 0 1920x1080x24' sh -c \
  'openbox >/tmp/galley-task5-final-openbox.log 2>&1 & obpid=$!; \
   trap "kill $obpid 2>/dev/null || true" EXIT; \
   npm run test:desktop -- tests/desktop/window-frame.spec.ts \
     tests/desktop/search-and-appearance.spec.ts \
     tests/desktop/close-pending.spec.ts tests/desktop/shell.spec.ts --workers=1'
```

Result: **20 passed (19.7s)**.

Additional verification:

- `npm run typecheck` — passed.
- `npm run package` — passed.
- `git diff --check` — passed.
- Focused `window-frame.spec.ts` after fixture/X11 corrections — 3 passed.

## Screenshot evidence

- `task-5-evidence/titlebar-900-light.png`
- `task-5-evidence/titlebar-900-dark.png`
- `task-5-evidence/titlebar-1920-light.png`
- `task-5-evidence/titlebar-1920-dark.png`

All paths are relative to this report directory. Screenshots were captured by
the native appearance test inside the same isolated 1920x1080 Xvfb display.

## Files changed

- `apps/desktop/src/renderer/TitleBar.tsx`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/book/BookWindow.tsx`
- `apps/desktop/src/renderer/app.css`
- `tests/desktop/window-frame.spec.ts`
- `tests/desktop/search-and-appearance.spec.ts`
- `.superpowers/sdd/2026-09-17-workspace-ux/task-5-evidence/*.png`

## Self-review

- Confirmed one title bar on welcome and book screens and no portal/state lift.
- Confirmed rare compact actions have one tab stop, and Zen exit remains visible.
- Confirmed conflict/save alerts are outside the drag region.
- Confirmed real Diagnostics opens from the compact menu.
- Confirmed no horizontal wrapping in the 900px screenshot and full action row
  at 1920px in light and dark themes.
- Preserved the controller's concurrent plan/ledger changes without staging them.

## Concerns

- macOS is unavailable in this Linux environment. The implementation preserves
  the existing `state.platform === 'darwin'` branch, 82px left inset, and omission
  of custom Linux controls, but it was not executed on macOS.
- The previously deferred Task 4 outside-click overlay focus issue remains outside
  this task, unchanged.
