# Final whole-branch review

Scope: `b11908f..011e860` in `/home/inky/Development/galley-desk`, supplied whole-branch diff, implementation plan, design addendum and Task 1/Task 2 review reports. Read-only source review; no tests, Electron sessions, production edits, git mutations or child agents.

## Verdict

**Changes requested: one P2 integration finding.** No other actionable findings identified. The explicit common-background requirement is implemented: central workspace, reading containers, Galley shell, content and gutters do not create an editor card. Existing settings migrate with their reading values intact; native selection restoration is guarded and preserves direction; preview blocking/dismissal integrates with action-popup Escape ordering and cleans up listeners.

## Finding

### [P2] Apply the configured UI typography to the new before preview

Location: `/home/inky/Development/galley-desk/apps/desktop/src/renderer/app.css:131` (and the label rule on line 132).

The passive preview hardcodes `13px` and uses `var(--desk-ui-font, Geist, system-ui, sans-serif)`, but no renderer code defines `--desk-ui-font`. `windowContainerStyle` at `apps/desktop/src/renderer/appearance/Appearance.tsx:110` sets the chosen UI family and size only on the outer window. Consequently, selecting a different UI font or increasing its size in Appearance updates the shell and action popup while “До правки” remains Geist at 13px, with its label fixed at 11px. This breaks the new independent UI settings specifically on the new preview surface, including readability for users who enlarge the UI.

Expose the configured UI family and size as inherited CSS variables in `windowContainerStyle`, consume both in the preview rule, and express its smaller label size relative to that size. Verify by choosing a nondefault UI family and size, opening a before preview, and checking that its typography follows those settings while the manuscript still follows the separate book settings. This is a small settings-integration correction, not a request for additional visual scope.

## Evidence and limits

The existing focused regressions cover popup selection restoration, preview-alone Escape, popup → Zen Escape, hover suppression, native gutter controls, wrapped Markdown and scroll dismissal. Author/controller-reported checks in the supplied reports were reviewed, not independently rerun. Fresh full Electron suite, performance checks and final screenshots remain controller-owned. Native macOS/titlebar/icon packaging and excluded storage/format work are outside this review.
