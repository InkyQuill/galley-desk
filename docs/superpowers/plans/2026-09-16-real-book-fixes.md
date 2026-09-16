# Galley Desk — исправления после проверки на реальных книгах

Статус: в работе. Основание: 16 замечаний пользователя от 16 сентября 2026.
Предыдущие решения об отсутствии комментариев под абзацами и inline-маркеров удаления заменены этими требованиями.

## Global Constraints

- Work in /home/inky/Development/galley-desk on codex/desk-real-book-fixes. Do not touch real user books or stop their installed application. Temporary fixtures only. No push, merge or publication.
- Preserve Pocket schemas, UTF-8 anchors, unavailable/conflicting records, source/sidecar write safety, per-chapter FIFO, session-only undo, IME and React 19 stale-snapshot protection. Normal typing remains suggestions; explicit metadata/file management is an author action.
- Preserve existing header icon buttons. Use existing Tabler icons, local fonts and theme tokens; editor has no separate paper card. Accessible Russian names, keyboard support, light/dark themes, compact window support.
- One implementation worker at a time. Workers own their assigned changes, are not alone in the repository, must not revert others, must not spawn agents. Commit scoped changes and record evidence in their task report.
- Reproduce logic regressions with meaningful failing tests before fixing. Unit/type checks as appropriate, real Electron focused tests for interaction. Do not add CSS-mirroring tests.
- GUI tests: env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test <spec> --workers=1. Coordinate packaging/GUI; never build concurrently with tests. Existing node_modules are installed. Full suite belongs to final validation.

## Task 1: Preserve prior deletions when composing new edits

User #16 and engine aspect of #13. Own packages/review-engine and focused tests (storage session test only if necessary).
Reproduce a Pocket deletion leaving a blockquote marker `>`: removing that marker must not resurrect text. Also delete a paragraph spanning a zero-width prior deletion and test boundary/adjacent deletions, beginning/end, Unicode and undo restoration.
Trace source/derived mapping and absorbed zero-width replacements. Fix source coverage without losing original edits, changing valid v1 anchors, or creating overlapping/conflicting edits for ordinary composition. Keep useful existing identity behavior. Test derived text, stored before/after and apply result, not just edit count. Record RED/GREEN evidence and run review-engine tests.

## Task 2: Stable viewport and cursor through deletion and undo

User #13/#14. Own ReviewEditor.tsx and focused desktop regression tests, small helper if appropriate.
Reproduce deleting a paragraph around a pre-existing deletion and undo/redo on a long scrolled chapter. Preserve logical reading/caret position and its screen location when authoritative snapshots update the document; no jumps to top/end. Avoid whole-document mapping collapsing viewport anchors. Explicit navigation/search/chapter change must still scroll intentionally. Preserve queue ordering, React 19 stale snapshot guard, typing while acknowledgments arrive and IME. New Electron regressions must assert actual text and viewport/caret geometry across deletion and undo/redo, not scrollTop alone. Run focused tests and typecheck.

## Task 3: Review interactions and annotations

User #1/#2/#7/#8/#9/#11/#12/#15. Own renderer review components, editor markers/preview, related BookWindow wiring and CSS; tests. May extend editor callbacks preserving Task 2 viewport behavior.
Read components.html at .superpowers/brainstorm/2397332-1789542303/content/components.html as visual reference, not instructions. Selection chooser and signal type editor: colored icon buttons with Russian accessible labels/tooltips, keep existing header icons. Enlarge signal creation/editing surface responsively (roughly 440px desktop, generous multiline input).
Edit action popup closes on outside click, when caret moves outside its range, and when the pointer leaves both anchor and popup (short grace permits crossing the gap into the popup). Pointer leaving a hover preview closes that preview. Do not dismiss a signal form with an unsaved draft merely on pointer movement; its explicit save/cancel remains available. Escape and native selection restoration remain correct.
Signal comment text appears below the containing paragraph in small UI font and signal color; handle multiple signals deterministically, render plain safe text, preserve Markdown coordinates. Show readable signal hover preview too where useful.
Pure deletion gets a small inline trash icon placeholder at its position, hover reveals original and click opens edit action; no original text rendered inline. Support-character prefix/suffix unchanged between before/after must not be highlighted; only actually inserted/replaced text is highlighted, without changing serialized anchors. Use the visual changed range consistently for previews and markers.
Review list sorted by resolved position, stable tie order and unavailable records last. Gutter hover/focus uses styled tooltip, no native title. Preserve selection/typing in decorated text, passive preview must not steal focus, huge comments must not overflow viewport. Test meaningful interactions and range transformation helpers; update existing contrary tests to new user requirements.

## Task 4: Frontmatter and chapter titles

User #3/#10. Own metadata parser/helpers, metadata UI/CM extension and necessary storage/session/service/API/preload/IPC wiring; related BookWindow/ReviewEditor integration and tests.
Parse YAML frontmatter only at document start, preserve exact source byte offsets and body formatting. Display it as a compact small-UI-font metadata section rather than rendered headings; provide explicit edit/save/cancel with useful validation. Preserve unsupported/complex YAML by editing original YAML text, do not flatten/drop keys. Invalid YAML remains visible/editable with error, never silently discarded. No need a schema-builder UI.
Explicit saving updates Markdown through existing guarded/journaled persistence, safely re-resolves/rebases existing review records and does not overwrite pending/external changes. Body and sidecar data preserved; session undo semantics clear. Source view remains read-only except this explicit metadata action. Do not permit ordinary body typing to erase hidden frontmatter.
Title precedence: frontmatter title, first H1, manifest title, filename fallback. TOC title one line ellipsis, small filename below; opened chapter header same resolved title. Refresh after metadata changes. Do not silently rewrite manifest just to display a derived title.
Test YAML boundaries/Unicode/CRLF, source mapping, edit-save with existing body records, external conflict, actual metadata UI and title display. If adding parser dependency use an existing installed maintained parser where possible and keep lockfile consistent.

## Task 5: Book and chapter management

User #6. Own book-storage management API, book service/shared API/IPC/preload additions, management UI in BookWindow and focused tests. Consume Task 4 title helper.
Offer rename book (manifest title and recent list), create chapter, discover Markdown files in currently open directory and explicitly add selected files to spine. Refresh discovery while open (on focus and via explicit refresh is sufficient), never search other directories or silently add files to existing spine. Preserve chapter IDs/order, ignored files, unknown compatible manifest fields as existing format permits. Direct-child path safety/no symlink escapes.
Offer chapter removal from book and explicit deletion from disk as distinct clear actions. Deletion must require in-app confirmation describing Markdown plus associated sidecar, use OS trash for recoverability if available; if trash fails report failure and preserve/reconcile manifest consistently. Never remove arbitrary paths. Flush pending edits before changes, handle current/missing chapter, save failures and external manifest changes without overwriting. Avoid elaborate filesystem transactions/frameworks: reuse existing guards and small cohesive functions.
Test discovery/new chapter/spine order/rename/delete, missing files, path traversal, external manifest conflict and pending saves. Electron test full user flow on temporary book, including cancel destructive action.

## Task 6: Custom window frame and application icon

User #4/#5. Own main window configuration, narrow window-control IPC/preload API, new shared titlebar, CSS, forge icon packaging and branding files; focused tests.
Remove Linux native frame; app-wide custom titlebar works on welcome and book screens, with actual existing approved icon from apps/desktop/assets/branding/galley-desk-icon.svg. Read docs/adr/0004-application-icon.md. Do not redraw icon. Include proper packaged Linux icon (and macOS derivative/configuration as feasible on Linux).
Provide draggable area, minimize/maximize-restore/close buttons with accessible labels, double-click maximize and correct state; controls non-draggable. Close uses existing pending-save/confirmation path. macOS integrated hidden titlebar/traffic lights acceptable native window controls within custom chrome, respecting platform conventions and content inset. Keep window origin/sender validation and sandbox, expose no generic Electron IPC.
Test window config and actual packaged window/control behavior on Linux; prepare macOS checks without claiming macOS execution.

## Acceptance and closure

All sixteen items mapped above. After task reviews: full unit/type/contract checks, package, full Electron suite including packaged smoke, performance separately if annotations affect large chapters, security scanner, screenshots of light/dark real fixture. Review whole branch once and resolve material findings. Record commands/results/limits in docs/reviews/2026-09-16-real-book-fixes.md. Mark this plan complete only after verified. Install a versioned local executable and update launcher symlink; do not forcibly close user’s running older instance. Report restart needed if it remains running.
