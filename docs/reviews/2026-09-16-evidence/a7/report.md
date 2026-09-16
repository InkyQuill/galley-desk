# Historical A7 platform acceptance — 2026-09-16

## Superseded Android status

The initial Android RED below is now GREEN after the canonical/legacy filename
fix. See [final compatibility report](../a7-compat/report.md). Linux artifacts
were rebuilt after that production change; hashes below identify the historical
build only. Mac and native IME remain not-run.

## Historical status: partial PASS; platform gate remains OPEN

Desk base: `d30237cefd13fe84d8b4a0cc2c72ba537aceee00` in
`/home/inky/Development/.worktrees/galley-desk-v0.1`.
Bounded production fix: `872a80a` — preserve selection on popup close through
CodeMirror focus API. The packaged artifact contains this fix; subsequent
changes are tests/docs only.
Pocket base: `f3012aa8abb73cda32b943ff74f5b78039300d8f`; test-only commit
`f2d44a1` in `/home/inky/Development/pocket-editor/.worktrees/galley-desk-tolerant-reviews`.
Editor source pin `4da44fcc1290381a8c9bbfdffcdb349dd68494cf`; Pad pin
`b78f22f27f00a98479369c6a18170e5d12aeb5c1`. Their source/published artifact
status is retained in verification.md and compatibility.md.

## What changed

- Real packaged executable smoke uses child-process spawn + Chromium renderer
  CDP, isolated profile and synthetic CRLF/emoji book. Production Electron
  fuses are unchanged. It opens via seeded recents, edits, waits for matching
  sidecar, closes the book, restarts the executable, applies and undoes, and
  compares exact source and review bytes. Does not cover the native picker.
- Desktop shortcuts use ControlOrMeta and platform-correct document ends;
  real Mac execution is still pending.
- A separate Chromium CDP composition commit/cancel test checks multiline,
  emoji and CRLF insertion, exact reconstructed saved text and unchanged
  original MD bytes. This is not native IME or real clipboard validation.
- Performance retains beforeinput→DOM and adds a separate dispatch→confirmed
  sidecar/UI-ack metric and exact text reconstruction after close/reopen.
- Pocket opt-in instrumentation imports exact synthetic Desk filenames into
  offline cache and registered Room availability, then calls the same
  ReaderRepository used by production UI. It performs no global DB clearing.
  It currently fails before SaveNote or export because sidecar discovery fails.
- Verification/runbook/plan updated honestly, keeping Mac/native IME/roundtrip
  and overall platform completion unchecked.

## Commands and actual results

Run from Desk worktree. Current user-manager environment was read via:

```bash
env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user show-environment
```

It supplied DISPLAY=:0, XAUTHORITY=/run/user/1000/xauth_GiQaAf and
GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module. These are observed
values for this session, not reusable hardcoded runbook settings. The prior
minimal-Electron diagnosis established GTK appmenu module unloading before
GIO callback; inheriting the desktop module environment fixes launch. No
Electron version or preload hack was added.

```bash
npm run typecheck
npm test
POCKET_EDITOR_DIR=/home/inky/Development/pocket-editor/.worktrees/galley-desk-tolerant-reviews npm run test:contracts
env -u NO_COLOR -u FORCE_COLOR npm run package
env -u NO_COLOR -u FORCE_COLOR DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_GiQaAf GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/Galley Desk-linux-x64/Galley Desk" \
  npm run test:desktop -- --workers=1
env -u NO_COLOR -u FORCE_COLOR DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_GiQaAf GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  GALLEY_PERF=1 npx playwright test tests/desktop/performance.spec.ts --workers=1
```

- Typecheck PASS (both before/after bounded fix).
- Unit 274/274 PASS, 21 files (both before/after fix); `unit.log`.
- Contracts 21/21 PASS, Pocket f3012aa; `contracts.log`. Harness-only later
  commit leaves production codecs unchanged; contracts do not prove filenames.
- Forge package PASS before and after fix; `package.log`. Nonfatal native-config
  compatibility warnings (three configs), inlineDynamicImports deprecation,
  bundle-size warnings. Color variables removed for final runs.
- Final complete desktop suite **44 passed / 1 explicitly skipped performance**,
  47.6s; `desktop-after-focus-fix.log`. Includes packaged smoke and composition.
- Later portable modifier changes (Ctrl+Enter→ControlOrMeta+Enter, link click
  Control→ControlOrMeta) covered by 13/13 focused review-actions/external-links
  PASS; `portable-shortcuts.log`.
- Final performance **1/1 PASS**, 29.6s; `performance.log` and
  `../a7-performance-results.json` contain every sample.
- `git diff --check` PASS.

### Esc regression: RED → GREEN

Two full-suite runs reproduced `review-actions.spec.ts` Escape case:
expected `кот !.\n`, actual `!кот спит.` after popup close. The original exact
assertion was retained. Isolated run passed, so a retry was not used to claim
success; full red evidence is `desktop-before-focus-fix.log`.
`RecordPopup` restored focus through native contenteditable.focus(), which can
reset browser selection to offset zero. CodeMirror.focus() restores its state
selection while suppressing the intermediate DOM observer. The bounded fix
uses `EditorView.findFromDOM(content)?.focus()` only for the editor fallback;
other connected focus targets retain their existing behavior. Full rebuilt
suite then passed, including unchanged exact replacement assertion.

### Performance interpretation

Host: CachyOS rolling, Linux 7.2.4-3-cachyos x86_64, glibc 2.44, AMD Ryzen
7 5800X, MemTotal 65,741,008 kB; Node 26.2.0 / npm 11.13.0 / Electron 44.4.0.
One worker; no other Electron suite running during measurements, emulator
left running; normal desktop background load, no claim of an isolated lab.
100 chapters, 1,048,645-byte large chapter, 500 records, 24 inputs:

- Launch+book open 573 ms; large chapter open **957 ms ≤2000**.
- beforeinput→DOM median18.8 / p95**27.6 ≤50** / max31 ms. Not paint/fsync.
- host keyboard dispatch→matching sidecar reconstruction plus saved UI ack
  p95**1033.0 ms**. Includes polling/verification overhead; no imposed budget
  and not physical media fsync timing.
- RSS main432,361,472 bytes, renderer heap29,400,000 bytes.
- Queue drained by Close, then reopen and exact full derived text checked;
  source bytes unchanged. No lost/doubled typing.

## Android app-layer RED reproduction and next ownership

Device emulator-5554, Android15/API35, sdk_gphone64_x86_64;
fingerprint `google/sdk_gphone64_x86_64/emu64xa:15/AE3A.240806.043/12960925:userdebug/dev-keys`.
Earlier full `./gradlew connectedDebugAndroidTest` at f3012aa: 242 testcase
XML entries, 237 pass,5 skip,0 failure, including UnavailableReviewCardTest;
controller log `/tmp/galley-acceptance-android.log`. Not rerun unchanged suite.

Input in `../a7-roundtrip-input` has active, stale and overlapping edits,
two signals, Unicode, CRLF and chapter_note. No personal books/credentials.
The harness only resets availability rows for the named synthetic book UUID.
The initial harness setup tried Gradle connected execution, whose install/
uninstall lifecycle removed private imported fixtures; a second attempt lacked
availability registration and timed out. Those were harness setup failures,
not claimed product evidence. Final direct instrumentation uses correctly
registered cache and fails on **expected Desk chapter_note vs null**.

Reproduce from Pocket worktree (adjust DESK below):

```bash
./gradlew assembleDebug assembleDebugAndroidTest
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
DESK=/home/inky/Development/.worktrees/galley-desk-v0.1
adb -s emulator-5554 shell run-as net.inkyquill.pocketeditor mkdir -p files/galley-roundtrip-in
for name in .pocket-editor.json chapter.md chapter.review.json; do
  adb -s emulator-5554 shell run-as net.inkyquill.pocketeditor sh -c "'cat > files/galley-roundtrip-in/$name'" < "$DESK/docs/reviews/2026-09-16-evidence/a7-roundtrip-input/$name"
done
adb -s emulator-5554 shell am instrument -w \
  -e class net.inkyquill.pocketeditor.GalleyDeskRoundtripTest \
  -e galleyRoundtrip true \
  net.inkyquill.pocketeditor.test/androidx.test.runner.AndroidJUnitRunner
```

Actual final output (`android-roundtrip-red.log`):
`java.lang.AssertionError: Desk chapter_note discovered by production Reader expected:<Desk roundtrip note> but was:<null>`;1 test,1 failure.
The exact filename is retained; passing by renaming fixtures is prohibited.
This reaches production ReaderRepository.observeChapter; it is not adb-only
proof and not just codecs. Record assertions, saveChapterNote and return
export are present but not reached. No cloud transport or visual UI assertion
is claimed. Next implementer must complete return-to-Desk ID/text/order checks.

**Scope of compatibility blocker:** Desk book-storage/book.ts reviewPathFor
uses `<stem>.review.json`, matching Pocket ADR0001:105. Pocket
BookPaths.REVIEW_SUFFIX and ReaderRepository lines294,335,355,419 append the
suffix to full `.md`; AtomicBookStore.readReview/writeReview invert/validate
that legacy name. SyncEngine, RemoteRevisionProbe, SyncBaseStore and discovery
paths/metadata keys also assume legacy filename. A safe fix needs canonical
naming plus preservation of existing legacy files and explicit dual-file
collision handling; changing only this fixture would conceal loss. Controller
approved a dedicated **sequential** compatibility subtask; no production Pocket
filename edits made here.

## Artifacts

Actual rebuilt/fuse-enabled executable:
`/home/inky/Development/.worktrees/galley-desk-v0.1/apps/desktop/out/Galley Desk-linux-x64/Galley Desk`.
Manual portable ZIP:
`/home/inky/Development/.worktrees/galley-desk-v0.1/apps/desktop/out/make/zip/linux/x64/Galley Desk-linux-x64-0.1.0.zip`.

`npx electron-forge make --skip-package --targets=@electron-forge/maker-zip`
from apps/desktop **FAIL: spawn zip ENOENT**. This host also lacks deb/rpm
tools. Used `python docs/reviews/2026-09-16-evidence/a7/make-portable-zip.py`
from Desk root. Script preserves UNIX mode bits and symlink entries, checks
ZIP CRC and executable bit. Archive has not been separately extracted and
launched; the included original packaged executable is what smoke tested.
SHA256 is in `artifact-sha256.txt`; app.asar hash identifies packaged app code,
whereas executable hash alone identifies Electron/fuses, not application JS.

## Remaining gates / self-review

Real Mac not-run: user has Linux only. Portable bindings and exact native Mac
checklist documented in runbooks/release.md; existing macos CI job not
remotely dispatched. Linux native IME not-run (no ibus/fcitx5); Chromium CDP
composition PASS does not substitute for it. Native clipboard/picker and
signing/notarization remain not-run. Android actual roundtrip FAIL is a release
blocker and overall A7 remains open. No redesign/original checkouts modified.

Self-review: all assertions preserved, no retry-as-pass or fuse weakening;
packaged profile/fixture isolated; logs and samples retained durably;
production fix limited to reproduced focus failure. Remaining concern: the
roundtrip harness is opt-in and intentionally RED until compatible sidecar
handling is fixed. Rebuild artifact and update hashes after any future
production changes; do not reuse this artifact to claim a later commit tested.
