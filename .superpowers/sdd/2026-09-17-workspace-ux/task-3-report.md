# Task 3 implementation report

## Implemented

- Added the shared `LayoutSettings` contract, `DEFAULT_LAYOUT` (315/336), and inclusive 240–560 sidebar bounds.
- Extended `DeskSettings` with a layout block. Missing, corrupt, legacy, or independently invalid layout data falls back to defaults while valid appearance and positions remain intact.
- Added main-side layout validation and the `DeskApi.layout()` / `DeskApi.setLayout()` path through the book service, IPC registration, and preload bridge. Existing top-frame sender validation remains the common wrapper for both channels.
- Serialized the complete read/modify/write operation for every `settings.json` writer through one `SaveQueue` per appData profile. Appearance, layout, and position writes now share the queue; rejected writes do not poison later jobs.

## TDD evidence

### RED

Command:

```text
npx vitest run apps/desktop/src/main/settings.test.ts
```

Expected failure before implementation:

```text
FAIL apps/desktop/src/main/settings.test.ts
Error: Cannot find module '/apps/desktop/src/shared/layout'
Test Files 1 failed (1)
```

The new tests referenced the required shared layout contract and persistence functions before they existed.

### GREEN

Focused command:

```text
npx vitest run apps/desktop/src/main/settings.test.ts apps/desktop/src/main/ipc.test.ts apps/desktop/src/main/book-service.test.ts && npm run typecheck
```

Result:

```text
Test Files 3 passed (3)
Tests 98 passed (98)
tsc -b --pretty false (exit 0)
```

Full unit suite:

```text
npm test
Test Files 34 passed (34)
Tests 442 passed (442)
```

The concurrency test deterministically blocks the first settings read, starts appearance and position saves while layout is in flight, then releases it and verifies all three blocks survive. The recovery test forces the profile path to be a file, observes the queued write rejection, restores the directory, and proves the next queued save succeeds.

## Files changed

- `apps/desktop/src/shared/layout.ts`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/main/settings.ts`
- `apps/desktop/src/main/book-service.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/main/settings.test.ts`
- `apps/desktop/src/main/ipc.test.ts`

## Self-review

- Confirmed every writer of `settings.json` enters the same per-profile queue before reading.
- Confirmed layout validation is performed in the main-process service rather than trusted to renderer or preload code.
- Confirmed invalid stored layout falls back independently instead of discarding valid appearance or positions.
- Confirmed no renderer Task 4 behavior, plan-owned files, Pocket schema, or sidecar path was changed.
- `git diff --check` is clean.

## Concerns

None.
