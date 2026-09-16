# Task 4 report: A4 — signal updates preserve identity

## Implemented

- Signal update commands now reuse `command.id`; new signals still receive `randomUUID()`.
- Before replacing a signal, the service verifies that the ID belongs to a signal in the current chapter and that its anchor is currently available. Edit IDs, unknown IDs, and unavailable signals fail with `UNAVAILABLE_RECORD` without changing the model or revision.
- Added service coverage for UUID preservation, changed type/comment, input Undo/Redo, close/reopen persistence, preservation of unrelated edits/signals, and rejection of invalid/unavailable IDs.
- Extended the desktop edit-signal scenario to compare the persisted sidecar UUID before and after the edit.
- Updated the deliberately failed-save desktop test to use explicit test-only Electron termination after its retained-draft assertions. Graceful close must refuse that state by design, so `app.close()` cannot be its cleanup path; production close behavior was not changed.

## TDD evidence

### RED

Command:

```text
npx vitest run apps/desktop/src/main/book-service.test.ts
```

Relevant output before the implementation:

```text
Test Files  1 failed (1)
Tests       2 failed | 33 passed (35)
audit: changing a signal preserves id... expected undefined to match the updated signal
signal update rejects... promise resolved instead of rejecting
```

The first failure reproduced the UUID regression: the old ID disappeared after update. The second proved that an edit ID was removed and converted into a new signal instead of being rejected.

The first complete desktop run also exposed the new safe-close contract in an older cleanup path:

```text
1 failed; 11 did not run
Test timeout of 120000ms exceeded
заметка главы сохраняется в sidecar; при ошибке черновик остаётся
[desk] close: code=SAVE_FAILED
```

The test intentionally creates an unsavable session, so graceful close correctly refused to exit. Its cleanup was changed to the explicit test-only termination pattern already used by `close-pending.spec.ts`.

### GREEN

```text
npx vitest run apps/desktop/src/main/book-service.test.ts
Test Files  1 passed (1)
Tests       35 passed (35)
```

```text
npm test
Test Files  21 passed (21)
Tests       271 passed (271)
```

```text
npm run typecheck
tsc -b --pretty false
```

```text
npm run package
Packaging application ... passed
```

```text
DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_GiQaAf GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  npx playwright test tests/desktop/review-actions.spec.ts --workers=1
12 passed (13.7s)
```

The focused changed scenario also passed independently: `1 passed (1.7s)`.

## Files changed

- `apps/desktop/src/main/book-service.ts`
- `apps/desktop/src/main/book-service.test.ts`
- `tests/desktop/review-actions.spec.ts`

## Self-review

- The mutation gate and session lifecycle remain in the existing `command()` path.
- Validation occurs before `removeRecord`, so rejected updates cannot delete edits or signals.
- Availability is determined by the existing `classifyReview` result; no replacement range is guessed for stale or ambiguous anchors.
- The same `replaceReview` operation records signal updates, preserving existing Undo/Redo behavior.
- No schemas or command interfaces changed.

## Concerns

- Real macOS execution remains pending because only Linux is available in this environment.
