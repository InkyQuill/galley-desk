### Spec Compliance

- ✅ Spec compliant. `packages/book-storage/src/session.ts:383` determines the boolean within the serialized job, returns false for an unchanged saved pair, true for adoption, and records a state transition only after draft preservation succeeds. `apps/desktop/src/main/book-service.ts:342` consumes that exact watcher outcome; `:647` consumes the command preflight outcome and `:652` checks the service revision again after awaiting.
- ✅ Scope is limited to the four intended implementation/test files; no unrelated feature changes.

### Strengths

- `apps/desktop/src/main/book-service.test.ts:965` uses a promise barrier around the real storage write. The recorded RED at `/tmp/galley-watcher-red.log:16` is the intended behavioral failure (two snapshots instead of one), not setup or import failure. Subsequent input, revision counts, genuine external adoption, stale-command rejection, and unchanged external disk contents are asserted in the same regression.
- `apps/desktop/src/main/book-service.test.ts:1010` independently exercises watcher adoption ahead of command preflight. The post-await service revision comparison rejects stale input without counting adoption twice.
- `packages/book-storage/src/session.ts:398` preserves the pending pair before clearing histories or entering external state. The change leaves failure handling and pending data ownership intact (`:450`). Existing tests at `packages/book-storage/src/session.test.ts:246` and `:266` assert pending-review preservation, unchanged external text, and no state transition on draft-write failure.
- `packages/book-storage/src/session.test.ts:424` now directly verifies false outcomes while retaining the model and undo history; `:232` verifies true on actual adoption.

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- None.

#### Minor (Nice to Have)

- `/tmp/galley-watcher-package.log:22` and `:34`: packaging succeeds but emits Vite config compatibility and deprecated `inlineDynamicImports` warnings. `/tmp/galley-watcher-e2e.log:8` and `/tmp/galley-watcher-close.log:8` emit conflicting color-environment warnings. These do not implicate this regression fix, but the validation output is not pristine. Track toolchain configuration cleanup separately and use one color setting for subsequent runs.

### Focused Checks

- Named risk: queue scheduling could detach the returned outcome from its operation. Inspected immediate dependency `packages/book-storage/src/save-queue.ts:9`; `enqueue` returns the actual job promise, serializes through its tail, and preserves later scheduling after rejection.
- Named risk: changed return contract could affect explicit conflict resolution. Inspected the remaining service caller at `apps/desktop/src/main/book-service.ts:718`; it intentionally awaits preservation and then performs explicit resolution with its existing revision update at `:735`, so ignoring the boolean there is appropriate.
- Named risk: unsaved work could be cleared by state reporting. Inspected the immediate `fail`/`adopt` helpers and existing preservation tests cited above. No changed preservation ordering or new clearing of pending data was found.
- The command diff ended mid-function, so the full command body and adjacent explicit-resolution caller were read to judge post-preflight sequencing. No broad audit or git commands were performed.
- Read the provided RED and final unit, typecheck, package, and both E2E logs. They report 278 unit tests, successful typecheck/package, and 9 focused desktop tests. No tests were rerun.

### Assessment

**Task quality:** Approved.

**Reasoning:** The operation-local boolean fixes the queued-own-save misclassification, and the second revision check covers genuine adoption by an earlier watcher. The deterministic regression and existing preservation checks support the intended behavior; only nonblocking validation-output warnings remain.
