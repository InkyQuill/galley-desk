# Task 1 shell restyling

Commit: 5f1d538 (feat(desktop): restyle reading shell and separate appearance typography)

## Changes
- Flat, full-height central reader shares the main background; removes both Desk and embedded Galley shell border, radius and shadow. Sidebars use compact tonal panels; responsive columns tighten below 1000px.
- Tabler search, view, Zen and overflow controls. Rare actions in keyboard-reachable menu; search hidden initially, Ctrl/Cmd+F opens/focuses; Escape first clears search query then closes. Existing higher-priority popup/flyout Escape handling retained.
- Review rows show colored pencil/bolt and ellipsis; full original accessible labels and status retained, details still in existing popup. Existing Pocket signal colors retained.
- Popup, note, appearance and inputs use app theme tokens and dialog shadow.
- Separate UI font family/size (Geist/13) and book typography (Literata/18); new width default 700. Saved legacy book font/size/width/theme and positions preserved; missing UI fields default, malformed fields rejected.
- Fontsource dependencies and locally resolved normal/italic variable font CSS. Production renderer emitted 24 WOFF2 assets, including Cyrillic/Cyrillic-ext where supplied.
- Existing Electron workflows adapted to explicit menu navigation and opening search; new Electron cases cover search/menu focus/Escape and independent UI/book sizes plus actual Cyrillic font loading.

## Checks
- First `npx vitest run apps/desktop/src/main/settings.test.ts`: expected RED, 2 new migration/independent validation cases failed before implementation.
- `npm test`: PASS, 26 files / 311 tests.
- `npm run typecheck`: PASS (final run immediately before packaging).
- `npm run package`: PASS, Linux x64. Ran package once after changes. Existing Vite configLoader/inlineDynamicImports deprecation warnings.
- `git diff --check`: PASS.
- Full Electron e2e and screenshot inspection delegated to controller as requested; no Electron runs by this agent.

## Scope / concerns
- Task 2 markers and ReviewEditor behavior untouched. Inline marker/current comparison decoration deliberately still exists for Task 2.
- No native macOS verification. User assets, ADR, inspirations and controller plan untouched.
- App uses existing free-text font fields; absent system custom fonts naturally fall back. New bundled defaults are locally served, no runtime external font request.
- Production CSS is compact (one selector declaration per line), matching the existing plain CSS workflow; no Tailwind migration.

# Review fixes — round 1

Commit: e8a16f0 (fix(desktop): inherit editor palette and handle search escape across controls)

- Read `/tmp/desk-shell-review.md` in full. Explicit dark themes were overridden by Galley's `data-theme` defaults, independently selected from OS scheme. `ReviewEditor` now passes the resolved scheme to Galley (3-line prop plumbing only), and its theme wrapper inherits the complete Galley theme token set from App: body, caret, links, Markdown/code palette, selection, surfaces. Central background stays transparent.
- Search-region Escape handler covers buttons as well as the input; query clears before closing, then a later Escape exits Zen. Existing higher-priority overlay handling retained.
- Burst-close test opens overflow before generating the burst; all 50 real transactions and Close click still run in one JS turn with no intermediate IPC drain. Legacy row assertion uses full accessible button name.
- New regressions first reproduced expected RED: search-button Escape left `кот`; explicit Gruvbox body remained rgb(26,26,26) instead of rgb(235,219,178).

## Selection/focus investigation

No speculative selection code change. The existing popup-cancel assertion remains exactly intact. Instrumented serial runs showed CM selection [4,8] preserved through Enter into the popup and Escape out; typing replaced that selection. Five traced serial runs and ten untouched serial runs all passed. Twelve copies with four concurrent Electron workers reproduced three failures (nine passes), consistent with native windows competing for focus. Controller confirmed screenshot capture in another native Electron window overlapped the original full suite. This supports a test-environment focus-contention explanation, not an identified production selection defect. Final isolated targeted popup-cancel test passed. Temporary trace instrumentation was fully removed.

## Exact checks

- `npm run typecheck`: PASS.
- `npm test`: PASS, 26 files / 311 tests.
- `npm run package`: PASS Linux x64; same existing Vite warnings. One package run for this fix round, no production changes afterwards.
- Electron command prefix for all commands below: `env -u NO_COLOR -u FORCE_COLOR DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_GiQaAf GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module`.
- `npx playwright test tests/desktop/search-and-appearance.spec.ts tests/desktop/theming.spec.ts --grep 'Escape на кнопках|явная тёмная' --workers=1`: before fixes, 2 expected failures (RED).
- `npx playwright test tests/desktop/review-actions.spec.ts --grep 'Esc закрывает' --workers=1 --repeat-each=5`: 5 passing traced diagnostics, `/tmp/desk-focus-trace.log`.
- `npx playwright test tests/desktop/review-actions.spec.ts --grep 'Esc закрывает' --workers=1 --repeat-each=10`: 10 pass, `/tmp/desk-focus-repeat.log`.
- `npx playwright test tests/desktop/review-actions.spec.ts --grep 'Esc закрывает' --workers=4 --repeat-each=12`: 3 fail / 9 pass with native-window contention, `/tmp/desk-focus-concurrent.log`.
- `npx playwright test tests/desktop/close-pending.spec.ts tests/desktop/search-and-appearance.spec.ts tests/desktop/theming.spec.ts --workers=1`: 16 passed, one test assertion corrected afterwards: CodeMirror drawSelection deliberately hides native caret, so test now inspects the actual drawn `.cm-cursor` border. `/tmp/desk-shell-round1-focused.log`.
- `npx playwright test tests/desktop/theming.spec.ts --workers=1`: all 4 PASS, includes body, actual caret, Markdown/selection palette on dark app/light OS. `/tmp/desk-shell-round1-theme.log`.
- `npx playwright test tests/desktop/open-book.spec.ts tests/desktop/review-actions.spec.ts --grep 'открывает главу: правка из sidecar|Esc закрывает попап' --workers=1`: both PASS, `/tmp/desk-shell-round1-targeted.log`.
- `node --import tsx /tmp/desk-design-capture.mjs /tmp/desk-after-light.png`: PASS, light/dark/900×720/Zen snapshots updated. Compact overflow `{ document: false, panels: [false, false] }`. Inspected dark and compact images: readable text, flat central area, no sidebar overflow. Capture closed its Electron app before notifying controller.
- `git diff --check`: PASS.

Controller plan changes and untracked user material excluded from commit. No active Electron processes from this agent remain.
