# Final Workspace UX fix wave

Base: `e6cfabe`. Addresses four Important and both Minor findings in
`final-review.md`. Important 3 remained partially open at this commit: a second
Escape was still consumed after the chapter menu closed and restored trigger
focus. No additional fix wave or subagents were used.

## Changes by finding

1. **Chapter menu clipping.** Added `AnchoredLayer`, a fixed portal under `.app-root`
   so theme/UI font cascade remains intact. Position comes from the anchor rect;
   horizontal position and available vertical height are bounded. ChapterMenu owns
   portal-aware outside clicks and initial focus. Sidebar overlay outside clicks
   recognize its nested portaled menu. Escape still returns focus to its trigger.
   Native assertions test painted button centers with `elementFromPoint`, including
   first/last rows and zero sidebar horizontal scroll. Real-copy capture also tests
   the last row of a narrow overlay and confirms one Escape leaves the overlay.
2. **Chapter note loss.** BookWindow retains per-chapter draft, open, error and busy
   state above both inline/overlay branches. ChapterNote updates that state through
   props. Hide/show, responsive collapse/expand and Zen do not save or discard it.
   Regression traverses those transitions with an unsaved note, then an intentionally
   rejected note command; draft and visible error survive every presentation.
   Disk assertion confirms the unsaved text was never persisted.
3. **Escape and modal ownership.** Window capture defers to native dialogs,
   metadata and focused nested menu/note handlers. Workspace-owned dismissals consume
   the event. Metadata capture also defers to any native modal. The Zen shortcut
   checks open native dialogs, including real Diagnostics, and consumes the shortcut.
   Regression covers search + clean metadata, search + dirty/discard metadata,
   search + native chapter dialog, nested overlay menu/note, and Diagnostics + Zen.
4. **Metadata clipping.** Metadata uses the same themed fixed layer, right-aligned
   to its trigger and clamped horizontally. Its scrollable height is calculated
   from the actual top edge. Portal padding counts as inside for outside clicks.
   Existing native metadata tests verify editing autofocus, read-only dialog focus,
   focus restoration, guards, validation and dirty-discard behavior. Real-copy
   captures add long YAML and discard at 1100/900 px and 125% zoom.
5. **Large tooltip bounds.** Shared tooltip CSS bounds height to viewport minus
   margins, clips overflow and wraps arbitrarily long tokens. A native 125% test
   supplies a 3000-character unbroken token and 150 comment lines, verifies all
   viewport edges and no horizontal overflow, and opens the full editable record
   card to verify the original entire comment remains available.
6. **Disconnected dialog trigger.** Chapter-dialog close now falls back to the
   connected chapter-toggle button when collapsed navigation has no row controls.
   Native cancellation asserts that keyboard focus and underlying search survive.
7. **Tooltip inventory.** System minimize/maximize/close and previous/next search
   controls now use the shared Tooltip while preserving accessible names.

## RED and GREEN

All native/GUI commands ran only under isolated Xvfb + their own Openbox, with
DISPLAY, XAUTHORITY and WAYLAND_DISPLAY unset first. No user desktop was accessed.

Initial RED (before production edits):

```text
npx playwright test tests/desktop/workspace-layers.spec.ts --workers=1
1 failed (3.3s)
Expected true; received false at workspace-layers.spec.ts:23
```

The failing assertion checked menu-button centers using `elementFromPoint`;
locator visibility alone had incorrectly accepted the clipped menu before this fix.

During implementation, focused reruns exposed the portal's initial ref/autofocus
ordering. The layer now performs placement immediately and once after refs settle,
using opacity rather than visibility during its initial measurement so autofocus
can run. Existing metadata native coverage passes again. Expanded tests also needed
fixture corrections: 900 px collapses review but keeps chapters inline (700 px is
used for chapter overlay); manifest fixture chapter title is required; injected
note-save failure correctly makes metadata read-only, so that failure segment runs
after metadata tests; responsive transitions await observable branch teardown.
No retries, increased timeouts or skips were added.

Final focused command:

```text
npx playwright test tests/desktop/workspace-layers.spec.ts tests/desktop/metadata.spec.ts --workers=1
3 passed (6.2s)
```

The preceding focused batch additionally passed management (4), sidebar layout (2)
and shared tooltip (5) cases. Its single new-test failure was the deliberate
save-error fixture entering metadata read-only mode, corrected as described above.

Final full native invocation:

```sh
GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk" \
env -u DISPLAY -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR \
XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
XDG_CURRENT_DESKTOP=KDE KDE_SESSION_VERSION=6 \
GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
xvfb-run -a -s '-screen 0 1920x1080x24' sh -c \
'openbox >/tmp/final-fix-full-openbox.log 2>&1 & obpid=$!; trap "kill $obpid 2>/dev/null || true" EXIT; npm run test:desktop -- --workers=1'
```

Full native: **104 passed / 1 expected performance skip (2.7m)**. One full run after final production changes; no failures.

Other gates:

```text
npm test                           36 files / 461 tests pass
npx tsc -b --force --pretty false   PASS
npm run package                    PASS
git diff --check                   PASS
```

Contracts were not rerun: this wave changes renderer presentation/state ownership
only; no contracts, Pocket schemas, sidecars, storage, dependencies or Undo logic.
Logs: `/tmp/final-fix-red.log`, `/tmp/final-fix-targeted-final.log`,
`/tmp/final-fix-full-native.log`, `/tmp/final-fix-unit.log`,
`/tmp/final-fix-type.log`, `/tmp/final-fix-package.log`, `/tmp/final-fix-capture.log`.

## Real-copy acceptance and visual inspection

`capture.mts` was rerun under the same isolated GUI environment with a configured
real-book fixture. Only its mkdtemp copy was opened. Source tree hash before and
after is identical:
`55253e0c7ff59af1ccac74ef4cefa6d0df90fd9e5089de58e912f334d5920046`.
It includes 27 Markdown chapters, 8 sidecars and 144 records. Existing stories
1 and 6–12 assertions continue to pass.

Refreshed screenshots under `docs/reviews/evidence/workspace-ux/task-13/`:

- `real-book-sidebar-menu.png`: both actions readable over center; no clipped sliver.
- `real-book-last-row-menu.png`: both actions remain inside viewport at bottom.
- `real-book-overlay-menu.png`: both actions visible outside narrow overlay bounds.
- `real-book-metadata.png`: complete YAML form, close and save controls visible.
- `real-book-metadata-1100-125-discard.png` and `real-book-metadata-900-125-discard.png`:
  full discard panel and both controls remain within viewport.

Viewed the first/last-row menus, narrow overlay menu, normal metadata and both 125%
discard images. Regenerated `contact-sheet.png` from current captures with
ImageMagick montage (labels, 3 columns, 400×280 tiles); no image content was altered.
Acceptance and verification documents link the corrected individual images.

## Self-review and limitations

Reviewed the final production diff, state callback ownership, themed portal root,
initial focus/restore, outside-click handling, native modal ordering and focused
regression assertions. Unsaved note state remains in-memory for the open book,
scoped by chapter; no new disk persistence is promised. Oversized noninteractive
tooltips intentionally clip, while full content remains in the record card.

Real macOS and system IME remain not run. The known deferred macOS selection failure
is unchanged and not claimed fixed. All source-book bytes stayed unchanged.

Commit: `ec589b0 fix: preserve workspace drafts and bound floating layers`.
The report stays in the ignored SDD scratch directory; production/tests/permanent
acceptance evidence are committed.
