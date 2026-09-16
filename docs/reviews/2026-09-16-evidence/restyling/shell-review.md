# Task 1 shell review

Reviewed supplied diff b10ea38..5f1d538 against Task 1 and global constraints. Task 2 gutter/hover work excluded. No tests rerun, repository edits, commits, or children.

## Verdict

Spec verdict: **Needs fixes** — the planned shell, tonal panels, Tabler controls, font separation, bundled Cyrillic fonts, legacy migration and 700px default are represented, but dark-theme readability and complete keyboard Escape handling fail the global constraints.

Quality: **Needs fixes**.

## Findings

1. **P1 — Preserve Galley foreground/theme tokens when removing its background.** `apps/desktop/src/renderer/app.css:52` (also line 85). These rules expose the dark application background while Galley retains its independently selected foreground. The controller screenshot `/tmp/desk-after-dark.png`, inspected during this review, shows almost invisible black body text on the dark reader. Narrow outside-diff inspection found `apps/desktop/src/renderer/editor/ReviewEditor.tsx:488` passes no theme to Galley; its installed implementation defaults to OS-auto, and `node_modules/@inkyquill/galley-editor/dist/style.css:162` colors the editor through `--ge-color-text`. An explicit dark application theme on a light OS therefore leaves the inner light foreground. Wire the resolved application theme/palette into the inner editor (including text, caret and semantic Markdown colors), while keeping its background transparent. Verify an explicit dark app theme independently of OS scheme.

2. **P2 — Escape becomes inert on search buttons.** `apps/desktop/src/renderer/book/BookWindow.tsx:271`. The capture handler returns for every target inside `.book__search`, but the query-clear/close handler exists only on the input (`apps/desktop/src/renderer/search/ChapterSearch.tsx:59`). Open search and tab to a previous/next/close button: Escape neither clears nor dismisses search. This is also an Escape-order dead end when search is opened in Zen. Handle Escape for the search region consistently, preserving higher-priority overlay handling and focus return. The added test exercises only input focus, so it does not cover this path.

## Validation scope

- Read supplied implementation report; unit/typecheck/package successes are author-reported, not rerun.
- Inspected controller dark screenshot and narrowly checked installed editor theme behavior to explain that concrete defect.
- Controller reports an additional failing legacy locator in `tests/desktop/open-book.spec.ts:169` (`getByText('Правка: кот спит → кит спит')`); intentional row truncation now retains this text as the accessible button name. Update that test to query the accessible button. Controller owns full suite and screenshot validation.
- No IPC, history, save, source read-only, or settings migration regression identified in this diff review. This is not a claim that pending full-suite checks passed.
