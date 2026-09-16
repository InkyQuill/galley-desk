# A7 folder compatibility — final 2026-09-16

## Result

**PASS: the real canonical Desk folder now passes Pocket Reader → SaveNote →
export → packaged Desk Apply/Undo. Existing Pocket legacy filenames remain
supported by both apps.** Overall A7 platform gate remains open for real Mac
and Linux system IME; this report does not claim those executions.

Pocket commit `002f609818b913db66680320da198d7eb7c972c6` —
`fix(storage): support canonical and legacy review filenames safely`.
Desk production commit `bb332c1` —
`fix(storage): preserve legacy Pocket sidecar filenames`.
Acceptance evidence/docs commit is recorded in the task handoff report.
Editor `4da44fcc1290381a8c9bbfdffcdb349dd68494cf` and Pad
`b78f22f27f00a98479369c6a18170e5d12aeb5c1` remain unchanged.

## Policy and scope

- Canonical `<stem>.review.json`; legacy `<chapter.md>.review.json` supported.
- Retain the sole existing name. New sidecars use canonical names. Outbox,
  remote revision, merge base and pending-deletion keys keep the actual name.
  Reader also considers existing metadata when the local sidecar is absent.
- Dual local/remote names block with an explicit error/action-required state,
  preserving both files. Identical duplicates also block; there is no automatic
  choice, rename, migration, schema extension or text/document merge.
- Map names to a unique manifest source; reject ambiguous identity instead of
  guessing (e.g. `chapter.md` and `chapter.md.md` sharing a candidate filename).
- Pocket touched BookPaths/AtomicBookStore, Reader reads/writes/invalidation and
  pending-deletion payload lookup, SyncEngine download/upload and orphan checks,
  RemoteRevisionProbe, RecoveryScanner, Room library repair/replacement/rename.
  AtomicSyncBaseStore already accepts both direct-child names and uses exact
  filename keys; no change needed. Gateway discovery already lists both suffixes.
- Desk resolves the name before reading/writing; journals retain their original
  review_path through recovery and exports. Dual names reject before pair writes.

## RED → GREEN

1. New AtomicBookStore canonical read/write and dual-write rejection tests:
   `./gradlew testDebugUnitTest --tests '*AtomicBookStoreTest'` — **RED 2 failures**
   (canonical rejected; legacy overwrote despite canonical counterpart).
2. New SyncEngine canonical remote discovery and dual-name rejection tests:
   `./gradlew testDebugUnitTest --tests '*SyncEngineTest.canonical remote*'
   --tests '*SyncEngineTest.dual remote*'` — **RED 2 failures**.
3. `npx vitest run packages/book-storage/src/book.test.ts` — **RED 2 failures**
   (legacy pair review null; dual files accepted), then **GREEN 37/37**.
4. Historical real Android RED is preserved in `../a7/android-roundtrip-red.log`
   and historical report. Same unchanged canonical input now **GREEN 1/1**.

The first changed-code full Android run had one failure: the earlier opt-in
roundtrip left its synthetic book registered in the app, so the pre-existing
`rootOpensBooksWhenNoUsableRootExists` test could not see an empty library.
The harness now exports then removes only its named synthetic registration,
cache, availability rows and outbox entries in finally. No global DB clearing.
The full suite was rerun after that fix: **240 passed / 6 opt-in skipped /
0 failures, 246 XML cases**. Gradle's console says “Finished 252 tests” because
its display counts skips differently; XML totals are retained in
`android-test-totals.json`. This was a harness-isolation fix, not a retry-as-pass.
Three library assertions were updated for new canonical replacement filenames;
all preservation/outbox assertions remain. New real Room/Reader cases exercise
new canonical creation, existing legacy writes, dual rejection with exact byte
preservation and canonical repair/base keys.

## Commands and final results

Pocket worktree: `/home/inky/Development/pocket-editor/.worktrees/galley-desk-tolerant-reviews`.
Desk worktree: `/home/inky/Development/.worktrees/galley-desk-v0.1`.

```sh
# Pocket
./gradlew testDebugUnitTest lintDebug connectedDebugAndroidTest
./gradlew assembleDebug assembleDebugAndroidTest
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# Reimport the three exact a7-roundtrip-input files to files/galley-roundtrip-in;
# command details match the historical report's run-as cat import.
adb -s emulator-5554 shell am instrument -w \
  -e class net.inkyquill.pocketeditor.GalleyDeskRoundtripTest -e galleyRoundtrip true \
  net.inkyquill.pocketeditor.test/androidx.test.runner.AndroidJUnitRunner
# Export .pocket-editor.json, chapter.md and chapter.review.json using:
adb -s emulator-5554 exec-out run-as net.inkyquill.pocketeditor \
  cat files/galley-roundtrip-out/chapter.review.json

# Desk
npm run typecheck
npm test
POCKET_EDITOR_DIR=/home/inky/Development/pocket-editor/.worktrees/galley-desk-tolerant-reviews npm run test:contracts
npm run package
# DISPLAY/XAUTHORITY/GTK_MODULES below were observed in this desktop session.
env -u NO_COLOR -u FORCE_COLOR DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_GiQaAf \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/Galley Desk-linux-x64/Galley Desk" \
  npm run test:desktop -- --workers=1
env -u NO_COLOR -u FORCE_COLOR DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_GiQaAf \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module GALLEY_PERF=1 \
  npx playwright test tests/desktop/performance.spec.ts --workers=1
# Rerun returned-folder cases after the final exact-manifest export:
# same desktop environment and executable, npx playwright test tests/desktop/pocket-return.spec.ts --workers=1
python docs/reviews/2026-09-16-evidence/a7/make-portable-zip.py
git diff --check
```

- Pocket unit **691/691 PASS**, lint/compile/APKs PASS.
- Full Android **240 pass / 6 explicit opt-in skip / 0 failures**; real opt-in
  canonical roundtrip separately **1/1 PASS** on the final code.
- Desk unit **276/276 PASS**, TypeScript PASS, contracts **21/21 PASS** at the
  exact Pocket commit above; package PASS.
- Full desktop **46 pass / 1 performance skip**; final returned-folder cases
  **2/2 PASS**, canonical unchanged and separate legacy variant.
- Performance **1/1 PASS**: chapter open1013ms≤2000; DOM median17.7/p95 27.8/
  max29.2ms, p95≤50; confirmed-save p95 1031.8ms (no budget).
  Main RSS478,334,976 bytes; renderer heap26,000,000. Full samples retained.
- Source/documentation whitespace checks PASS in both worktrees. Raw tool logs
  retain blank final lines, and the returned fixture retains intentional CRLF;
  unfiltered git diff --check reports those preserved evidence bytes.

## App return evidence and exact comparisons

Input `../a7-roundtrip-input` is unchanged. Harness imports manifest bytes using
replaceDownloadedManifest (the old harness used writeManifest, unnecessarily
upgrading imported v1). Production Reader discovers all original UUIDs/order;
saveChapterNote modifies only the note. Export is in `../a7-roundtrip-returned`.

`returned-comparison.txt`: source **and manifest exact bytes**, edit and signal
arrays **deep-equal**, note = `Pocket roundtrip note 🦊`. Source SHA256:
`57a7164626f91075bb4674b3d96eadcacb6c08ce72559cbed7cdfdddb8ddadc8`.

The rebuilt, fuse-enabled packaged Desk opens this export using a clean seeded
recent-book profile and renderer CDP. It displays six records: three active,
two conflicting and one unavailable. The unavailable card opens. Applying
`delta → DELTA` changes source; Undo restores source and full review bytes,
manifest stays exact. The legacy variant uses the same exported payload under
`chapter.md.review.json`; the exact canonical test still runs independently,
so this does not rename the original fixture to conceal failure. The legacy
file remains the only sidecar after Apply/Undo. Storage tests also cover legacy
journal recovery and dual-file rejection before any journal or pair write.

## Artifacts, limitations, self-review

[Final hashes](artifact-sha256.txt) identify the rebuilt production code:
app.asar SHA256 `d380e2ba2aaab1aa52f7c2dec1c7905ddbf3d6188fca4733130a996beef73b0e`;
portable ZIP SHA256 `d0f454ceaee9e7d5cbd12f6575ec327ea42e98ac19cd322bf30161f97937c39a`.
Executable SHA stays the same because it identifies Electron/fuses, not app JS.
Original packaged executable was tested; separately extracted ZIP was not.

Host/device and platform limitations are unchanged from the historical report:
Linux only; real Mac execution and Linux system IME not-run (Mac prep only).
Chromium composition is not an OS IME test; no native clipboard/picker claim.
Android tests exercise production Reader, cache and Room, not cloud transport
or a visual Pocket UI roundtrip. No credentials/personal books used. No remote
publish/push/merge, redesign, Editor/Pad or original checkout changes.

Self-review checked filename selection before side effects, exact identity
mapping, actual metadata keys, pending deletion lookup, recovery journal names,
new versus legacy creation, and exported byte comparisons. Existing filename
forms are intentionally never automatically consolidated. Large existing
Reader/SyncEngine/library files remain structurally unchanged. Known build
warnings are nonfatal (Yandex client id unset, JVM CDS, Vite compatibility and
bundle-size warnings; pre-existing Kotlin unnecessary-safe-call warnings in ReviewProjectorTest). No remaining known compatibility blocker in this scope.
