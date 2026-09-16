# Task 2 scoped re-review

Scope: combined fixes `1f18732..011e860`, from `/tmp/desk-markers-fixes-review.diff`, plus appended implementation evidence. Reviewed only the addressed color finding and potential breakage introduced by the runner/preview fixes. No tests rerun, source edits, git mutations, or child agents.

## Verdict

- **Spec: Approved** for the reviewed Task 2 scope.
- **Quality: Approved.** No actionable findings in this fix diff.

## Findings resolved

- The ordinary gutter pencil and ReviewList now both use shared `EDIT_MARKER_COLOR`, resolving the P2 semantic-color mismatch. Existing signal colors and deliberate deletion color remain intact; the shared CSS variable follows the active theme.
- Action popup/card visibility explicitly blocks passive previews. Both opening and closing set sticky dismissal, so programmatic focus restoration and snapshot acknowledgements cannot insert an extra preview into the popup → Zen Escape sequence.
- Explicit selection/input events, hover, and keyboard Tab focus can resume preview. The block still wins while the action popup is open, and nonempty selection continues to win for signal creation. Preview-alone Escape behavior remains covered by the unchanged existing path.
- Added document listeners are removed on destruction. Deferred focus handling still checks destruction and actual current focus. Tab intent is cleared after use or when focus moves outside the editor, preventing stale keyboard intent from reviving a dismissed preview on restoration.
- Serial Playwright workers directly address the reported native-window focus contention. This changes test scheduling, preserves assertions, and remains overridable from the CLI.

## Evidence and limits

The report records typecheck, package, and diff-check success, plus 4/4 isolated Electron cases covering popup → Zen priority, preview-only Escape, keyboard signal creation, and selection restoration. The old Zen assertion was retained; explicit no-preview-during/after-popup assertions were added. These are author/controller-reported executions, not independently rerun here. Final complete suite and light/dark visual acceptance remain controller-owned.
