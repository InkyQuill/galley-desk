# Task2: review gutter and before preview

## Implementation

- Real CodeMirror gutter with one native button per active resolved record. Tabler pencil/bolt icons preserve existing accessible names; pure deletions remain separate buttons. CM's decorative aria-hidden ancestor is explicitly exposed for this interactive gutter.
- A mapped record StateField drives gutter positions, caret/hover preview and imperative reveal while input acknowledgements lag. Unavailable/conflicting records stay sidebar-only. Each gutter button is measured against the actual wrapped row using CM requestMeasure; visual-row peers use distinct ordered columns.
- Decorations contain only range marks: edits have a soft background, signals a lower-third colored band. No inline icon widgets or signal comment blocks. Signal comments remain sidebar and actionable popup content.
- Shared passive CM tooltip shows before text for caret, hover and gutter focus. Safe textContent, pointer-events:none, no focus transfer or text/history command. Nonempty selection wins for signal flyout; scroll dismisses; Escape closes preview before Zen. Hover/highlight clicks still open existing RecordPopup. Focus callbacks defer until native focus finishes, re-read actual current focus, and ignore destroyed views.
- Scoped RecordPopup restoration correction uses public CM domAtPos and native Selection only if CM focus leaves actual DOM selection different from the saved main selection. Anchor/head direction is preserved. Ordinary input restoration and guard against stealing another input's focus remain.

## RED/GREEN investigation

1. Initial focused Electron run exposed CM gutter ancestor aria-hidden=true, so native record buttons were absent from accessibility queries. Fixed exposing the interactive gutter and using outer-editor hover/focus listeners (CM domEventHandlers otherwise receive content events only).
2. Existing Escape regression became order-dependent: first run keyboard signal creation/comment test, then `Esc закрывает попап без создания сигнала и возвращает фокус в редактор`. Selected4..8 (спит) became0..0 after popup closure; subsequent typing yielded `!кот спит.` instead of `кот !.`. Alone it passed3/3, pair reliably failed.
3. Trace captured state4..8 through textarea focus and showed actual browser selection still empty immediately AFTER complete CM view.focus returned. document.hasFocus was true. CM's DocView.updateSelection compares cached observer.selectionRange by default; cache still matched4..8 so actual DOM selection was not rewritten. Later selectionchange adopted native0..0.
4. Deferred preview focus updates alone and routing connected content through CM focus alone were insufficient. Final mismatch-only native selection correction yielded the narrow pair4/4 (two repeats), without debug delays/instrumentation. Debug instrumentation was removed.

## Validation

- `npm test -- apps/desktop/src/renderer/editor/markers.test.ts apps/desktop/src/renderer/editor/transaction-adapter.test.ts`:17 passed (mapped optimistic changes, zero-length deletion, exclusion of conflicting/unavailable ranges, no inline widgets, transaction adapter regressions).
- `npm run typecheck`: passed.
- `npm run package`: final package passed (nonblocking existing Vite config warnings only).
- All Electron execution exclusively on controller's isolated Xvfb: `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR DISPLAY=:1 GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module npx playwright test ... --workers=1`.
- Narrow regression pair with `--grep 'клавиатурный путь|Esc закрывает' --repeat-each=2`:4 passed after selection fix.
- Final focused review-actions suite:14/14 passed in13.9s. New cases cover caret/hover without focus loss and continued typing, highlight click actions, selection Tab priority, Tab between real gutter buttons, Zen Escape ordering, wrapped Markdown alignment, zero-length deletion preview/action and scrolling dismissal.

## Scope and limitations

Only Desktop renderer and focused regression tests changed. No storage, review-engine, shared editor, transport queue, package/dependency, prototype or user-asset changes. Native macOS untested. Final full suite, performance, dark/compact/Zen visual acceptance and independent review belong to controller. Tooltip is a bounded preview (long before text remains available in actionable record popup).

Commit:1f18732 (`feat(desktop): move review markers into gutter and preview original text`).

Self-review: `git diff --check` passed. Real Electron screenshot `/tmp/desk-task2-gutter-preview.png` inspected: separate pencil/bolt gutter buttons, clean text with range-only highlights, common reading background and passive before tooltip. No Electron/package process remains; DISPLAY=:1 released to controller.

Potential follow-up for independent review: hover on manuscript while an existing nonmodal action popup is already open can still show the passive preview when selection is collapsed; popup retains focus and preview cannot intercept pointer events. Evaluate whether visual suppression is preferred.

## Independent review fix round1

- Review P2 accepted: ordinary gutter pencil used muted text while ReviewList used the theme accent. Added shared `EDIT_MARKER_COLOR` semantic reference to `var(--desk-accent)` and reused it in both surfaces. No new hardcoded palette, no changes to signal colors or pure-deletion color.
- `npm run typecheck` and `git diff --check` passed. No CSS-value-mirroring test added, as requested by review. Controller owns final rebuild and light/dark screenshots to compare the two pencils together.
- Commit:97c205e (`fix(desktop): share edit pencil color across review surfaces`).
- Additional controller-authorized runner correction: Playwright defaults `workers:1` because native Electron windows share keyboard focus, including under Xvfb. CLI overrides remain available. No extra scaffold/config test. Controller has a concrete parallel-run failure reproduction; final serial suite verifies behavior.
- Runner commit:4606e7d (`test(desktop): serialize native Electron windows by default`).
- No package or GUI execution during controller's active final suite; display remains entirely controller-owned.

## Controller full-suite fix: popup → Zen Escape priority

- Controller reproduced one functional failure in `search-and-appearance.spec.ts:324`: after action popup Escape, editor focus restoration reopened passive before preview; the next Escape dismissed preview rather than exiting Zen. Existing assertion was retained and strengthened with explicit no-preview-after-popup assertion.
- Preview state now distinguishes an action-popup block from sticky dismissal. BookWindow supplies action/card visibility; closing the popup retains dismissal through programmatic focus restoration and snapshot updates. Explicit user cursor/input, hover or keyboard Tab focus resumes preview; while popup is open, preview remains suppressed. Tab intent is cleared when focus lands elsewhere so later restoration cannot reuse stale keyboard intent.
- Added assertions in the existing gutter regression: hovering highlighted text while the action dialog is open shows no passive tooltip, and closing the dialog leaves no tooltip. Passive-preview-alone Escape-before-Zen behavior is retained in the same test.
- `npm run typecheck`: passed. Final `npm run package`: passed. `git diff --check`: passed.
- Targeted isolated Electron command: `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR DISPLAY=:1 GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module npx playwright test tests/desktop/search-and-appearance.spec.ts tests/desktop/review-actions.spec.ts --grep 'Zen: панели|gutter:|клавиатурный путь|Esc закрывает' --workers=1` →4/4 passed (4.3s). Covers the existing popup-Zen failure, passive-preview Zen path, and order-dependent signal/Escape selection pair.
- Commit:011e860 (`fix(desktop): keep previews dismissed after action popup closes`). No full-suite rerun; controller owns final combined review/full validation. DISPLAY=:1 released after tests.
- This resolves the earlier report's optional hover-during-popup limitation: action popups now suppress passive preview entirely.

## Final integration fix: preview interface typography

- Reviewer P2 accepted: preview had fixed13px typography and fallback Geist because --desk-ui-font was never defined. Existing windowContainerStyle in Appearance.tsx now exposes actual saved interface family/size as --desk-ui-font and --desk-ui-size. Preview consumes both; label uses relative .85em. Book typography remains independent.
- Extended the existing real appearance test via user controls: choose Georgia18px interface and20px book, create an edit, verify actual computed tooltip family contains Georgia and tooltip size is18px while editor text stays20px and keeps keyboard focus. This exercises settings reaching a nested CM tooltip rather than mirroring CSS variables in a unit test.
- `npm run typecheck`: passed. `npm run package` including Vite production builds: passed. `git diff --check`: passed.
- Isolated targeted appearance+preview Electron tests: `env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR DISPLAY=:1 GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module npx playwright test tests/desktop/search-and-appearance.spec.ts tests/desktop/review-actions.spec.ts --grep 'оформление: тема|gutter:' --workers=1` →2/2 passed (2.3s).
- No full-suite rerun; controller owns final performance validation. DISPLAY=:1 released.
- Commit:1f75a5e (`fix(desktop): apply interface typography to before preview`).
