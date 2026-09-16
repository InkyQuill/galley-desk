# A7 review fixes, round 1 — 2026-09-16

FIX_BASE: Desk `86ef67ef47e595abc7fc420a38b015c1cc6f1a5a`.
Pocket compatibility HEAD `002f609` unchanged. No production or companion
code changed; existing packaged artifact reused, no package rebuild or broad
Android/companion reruns. Previous RED logs and warning disclosures retained.

## Changes responding to review

1. `tests/desktop/packaged-app.ts` now owns the actual executable spawn,
   diagnostic pipes, startup errors and renderer CDP attachment for both
   packaged-smoke and pocket-return. Endpoint discovery, CDP connection and
   first-page wait are each bounded at 30s. Spawn ENOENT is an ordinary rejected
   launch promise. Startup listeners/timers are removed after settlement;
   diagnostics are capped at 16KiB and both pipes drained. Stop is idempotent,
   bounds CDP disconnect at 3s and always attempts termination even if disconnect
   fails. SIGTERM gets 3s, then SIGKILL gets 3s, then reports a cleanup error.
   Failed launches also stop their child. Test fixture cleanup executes even
   when stop fails. Existing behavior/byte assertions retained in both callers.
2. Composition test closes/drains the book, reconstructs exact persisted `日本`
   from disk, checks original MD bytes, reopens and asserts exact Japanese DOM
   plus absence of canceled text **before** the separate multiline/emoji/CRLF
   paste case. Its original paste save/reopen assertions remain intact.
3. Current verification banner says Android discovery blocker was fixed and
   roundtrip passed. Historical RED remains intact. Mac/native IME not-run and
   the open overall gate remain explicit.

## Verification

Working directory `/home/inky/Development/.worktrees/galley-desk-v0.1`.

```bash
env -u NO_COLOR -u FORCE_COLOR DISPLAY=:0 \
  XAUTHORITY=/run/user/1000/xauth_GiQaAf \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/Galley Desk-linux-x64/Galley Desk" \
  npx playwright test tests/desktop/packaged-smoke.spec.ts \
  tests/desktop/pocket-return.spec.ts tests/desktop/edit-and-reopen.spec.ts --workers=1
```

**7 passed (10.7s)**, no skips; full output `targeted.log`. Display/xauth
values belong to the existing session, not portable hardcoded instructions.

```bash
npx playwright test tests/desktop/packaged-app.spec.ts --workers=1
```

**2 passed (33.5s)**, no skips on Linux; full output `launcher.log`.
The first case verifies an absent executable produces a handled ENOENT error.
The second launches a real synthetic executable that emits no CDP endpoint
and ignores SIGTERM, checks the bounded timeout and confirms its PID no longer
exists after SIGKILL fallback. The test has defensive cleanup of its own.
This run emitted the known NO_COLOR/FORCE_COLOR environment warning; it is
retained, not described as pristine or as a compiler error.

```bash
npx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --skipLibCheck \
  tests/desktop/packaged-app.ts tests/desktop/packaged-app.spec.ts
git diff --check
```

Both PASS (exit0, no output). Focused tsc checks the new helper/error-path tests;
production types/code were unchanged.

## Self-review and limits

Reviewed caller diffs: all packaged save/restart/apply/Undo, returned-record
classification, manifest/source/review byte equality, and single sidecar
assertions retained. The helper changes test infrastructure only and does not
alter production fuses. No output warning cleanup attempted; native-config,
inlineDynamicImports and JVM CDS warnings remain tracked in prior evidence.
Real Mac/system-IME validation is still pending under the Linux-only scope.
