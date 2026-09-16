# Remaining CI failures: deterministic checks

- Book management: delaying the actual exclusive `b.md` open by 250 ms reproduces ENOENT in the old polling callback. Polling now retries only missing-file errors. Test teardown explicitly exits so an assertion failure is not hidden behind the application's guarded quit.
- Keyboard preview: the diagnostic trace shows native focusout temporarily activates the document body, followed by focusin. Tab intent must be captured on focusin, not consumed by focusout. A later native focus scroll then cleared the correctly opened preview. Scroll now preserves only the tooltip whose record ID matches the actively focused gutter or inline deletion button.
- Strict regression coverage: actual Tab/Shift+Tab focus transitions, inline and gutter previews, a subsequent scroll event, Escape dismissal, Enter action, and hover on another record followed by scroll dismissal.
- No diagnostic instrumentation remains in production or tests. `keyboard-preview-diagnostic.log` retains the temporary bounded transition trace as evidence.

Final validation: both affected native tests repeated five times, 10/10 passed; package and typecheck passed. Linux execution used isolated Xvfb and Openbox. macOS verification remains for CI.
