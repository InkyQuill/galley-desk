# Task 4 — safe metadata and chapter titles

## Outcome

Implemented and committed as `42f6ec0` (`feat: safely edit chapter metadata and resolve source titles`). No push. Only assigned application, engine/session, dependency and test files committed. Controller docs, icon assets and other user files preserved.

## Implementation

- Shared Desk-only frontmatter helper recognizes delimiters only at document start, including CRLF, and retains separate raw UTF-16, UTF-8 byte and normalized editor boundaries. Original YAML text survives editing; no object serialization flattens keys, nested values or comments.
- Parser dependency `yaml` pinned to 2.8.2, core schema, AST-only parsing, no custom executable tags or alias expansion. Unknown/unsafe tags and invalid YAML remain visible with errors. Existing root js-yaml was unsafe v3 API; it was not used. Existing `@lezer/markdown` 1.7.2 declared directly for Markdown H1 resolution. Lockfile diff bounded; extract-zip alias/override and rolldown versions preserved.
- Metadata section uses compact UI font and explicit Edit/Add, Save and Cancel controls. Validates YAML before transport; errors stay with the editable raw YAML. Describes successful save clearing session undo history.
- CodeMirror keeps its complete normalized document. A replacement decoration hides the prefix, atomic range/navigation puts caret in the body, and transaction filtering protects against cross-prefix deletion/paste and body-start Backspace. Snapshot-authorized replacement remains available; no source-prefix stripping, offset rebasing guesswork or stale visual-record recomputation.
- Metadata is a typed command over existing sender-checked IPC/preload command transport. No new broad IPC route. Form retains its original full source base, so a watcher-adopted source cannot be overwritten by a stale form using a new revision.
- While the form is open and through save/ACK, body editor is read-only. Existing typing FIFO is flushed before source replacement; editor remounts on the authoritative saved snapshot. Normal typing remains review suggestions.
- Session mutation shares `applyEdit` source-range rebasing logic; guarded journaled `writePair` is the only disk persistence path. Successful metadata changes clear both session histories. Failed writes preserve pending drafts and history behavior. Unavailable/conflicting records remain untouched; actual overlapping active records are rejected.
- Important integration fix found in real Electron: a body-start insertion may borrow the preceding delimiter newline for its Pocket anchor. Replacing the entire prefix falsely rejected it. Metadata save now trims byte-identical prefix/suffix at valid UTF-8 boundaries before replacement, keeping unchanged delimiter/support bytes and safely rebasing body records.
- Benign metadata validation/stale-form rejection checks actual main session state and does not latch BookWindow saveError/close guard; genuine persistence failures still do. Cancel and Close book after stale rejection covered in Electron.
- Title precedence: frontmatter string title, first actual Markdown H1 (ignoring fenced code), manifest title, filename stem. Existing-book TOC reads source-derived title without mutating manifest; opened header and TOC refresh from snapshot title. TOC name is one-line ellipsis with small filename below.

## Verification

RED evidence:

1. New shared metadata tests failed on missing helper and engine test failed on missing explicit source replacement export.
2. Real Electron found body-start support-newline overlap. Added session regression failed with `Active records overlap metadata`; same regression passed after trimming unchanged boundary bytes.

Final focused unit command:

`npx vitest run apps/desktop/src/shared/metadata.test.ts apps/desktop/src/renderer/editor/frontmatter.test.ts packages/review-engine/src/apply.test.ts packages/book-storage/src/session.test.ts apps/desktop/src/main/book-service.test.ts apps/desktop/src/main/ipc.test.ts`

Result: **6 files, 88 tests passed**.

`npx tsc -b --pretty false` and `git diff --check`: passed.

`npm run package`: passed; explicitly checked executable `apps/desktop/out/Galley Desk-linux-x64/Galley Desk` exists and is executable. Last post-package changes were formatting and local snapshot chapter-variable deduplication; controller owns final full package/suite validation.

Actual Electron command:

`env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/metadata.spec.ts tests/desktop/review-actions.spec.ts --grep 'metadata display|delayed ACK|paragraph annotation' --workers=1`

Result: **5 passed (5.3s)**. Includes Task3's two delayed-ACK live visual-coordinate cases and both paragraph-ending newline cases.

Metadata Electron scenario covers: hidden frontmatter; source-based TOC/header; actual body-start Backspace and typing; select-all/delete/undo; original source unchanged by ordinary typing; invalid YAML validation; explicit save over existing insertion; exact CRLF body/comment/complex-value preservation; rebased active record; title refresh; cancel; read-only raw Source view; watcher-adopted external title while stale form remains; rejected stale Save; cancel and successful Close book without false persistence error.

Screenshot inspected: `/tmp/galley-metadata-ui.png` (temporary fictional fixture, compact metadata/UI/title and body suggestion).

## Limits / review focus

- Active records that truly overlap changed metadata require resolution before saving; no guessed merge. Unsupported YAML tags are shown as validation errors, with original text retained.
- Unterminated frontmatter conservatively treats the remaining source as raw metadata because a reliable body boundary does not exist; error and editable original text remain visible.
- No full-suite run in this task; controller owns final validation.
- Initial failing Electron test cleanup stalled because the benign overlap rejection had latched the generic save-error close guard. Fixed with actual-session-state distinction and added regression. Only the temporary test app/process was force-stopped; installed real-user app was not touched.

Build/GUI slot released; no outstanding implementation blocker.

## Review fix round 1 (base 42f6ec0)

Committed `0ca6eaa` — `fix: preserve BOM source offsets and Setext chapter titles`.

Both review findings reproduced RED before fixes: raw snapshot source omitted BOM (LF and CRLF cases), session rejected exact BOM-bearing source base, and CRLF Setext title leaked underline. Fixes:

- Added a BOM-preserving decoder for raw source transport, stale-form comparisons, and metadata replacement text. Existing source BOM counts in metadata byte boundaries; adding metadata to BOM-only-prefixed manuscript replaces the original BOM prefix so exactly one remains. Engine/CM derived text still omits BOM.
- Source prefix helper now explicitly separates BOM-inclusive byte/raw UTF-16 boundary from BOM-free normalized editor boundary.
- Actual BOM body-insertion session regression uncovered pre-existing engine `byteOffsetInSlice` omission: decoded slice omitted BOM, but source byte accumulator started at zero. It now accounts for those three bytes, and service's inverse RecordView mapping subtracts them. No engine decoding or CM conventions changed.
- Setext extraction now stops at the Markdown parser's HeaderMark child boundary, handling CRLF and indented underline without regex line-ending assumptions.

Amended paths for scoped rereview:

- apps/desktop/src/main/book-service.ts (+ matching test)
- apps/desktop/src/shared/metadata.ts (+ matching test)
- packages/book-storage/src/session.ts (+ matching test)
- packages/review-engine/src/pieces.ts (+ matching test; newly involved mapping path)
- tests/desktop/metadata.spec.ts (fixture now starts with UTF-8 BOM)

Verification commands/results:

`npx vitest run apps/desktop/src/shared/metadata.test.ts apps/desktop/src/main/book-service.test.ts packages/book-storage/src/session.test.ts packages/review-engine/src apps/desktop/src/renderer/editor/frontmatter.test.ts` → **10 files, 137 tests passed**. Includes all review-engine tests; exact raw BOM bytes before/after LF and CRLF metadata saves; adding metadata retains exactly one BOM; body insertion with support anchor; body signal's inverse presentation offsets; normalized engine boundary mapping over CRLF + emoji; Setext LF/CRLF and indented underline.

`npx tsc -b --pretty false` and `git diff --check` → passed.

`npm run package` → passed; executable checked at `apps/desktop/out/Galley Desk-linux-x64/Galley Desk`.

`env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module xvfb-run -a npx playwright test tests/desktop/metadata.spec.ts --workers=1` → **1 passed (2.6s)**, full metadata workflow with BOM fixture, body typing, exact-source preservation, save/title refresh, stale external form rejection and close.

Root README/docs/user assets remain untouched and unstaged by this task. GUI/build slot released. No outstanding blocker.
