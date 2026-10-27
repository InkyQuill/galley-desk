# Galley Desk Agent Guide

## Project overview

Galley Desk is a local-first desktop application for reviewing Markdown books on Linux and macOS. It is built with Electron, React 19, TypeScript, CodeMirror 6 through Galley Editor, and Electron Forge/Vite.

The user opens a book directory, edits the derived reading text, and stores proposed edits, signals, comments, and chapter notes in Pocket Editor-compatible sidecar files. Canonical Markdown must remain byte-for-byte unchanged until the user explicitly applies an edit or changes metadata.

The repository is an npm-workspaces monorepo. Node must satisfy `>=22.13.0`; the lockfile is authoritative. Use `npm`, not another package manager.

## Repository map

- `apps/desktop/` — Electron application.
  - `src/main/` — trusted filesystem, persistence, diagnostics, window lifecycle, and IPC handlers.
  - `src/preload/` — narrow `contextBridge` implementation of `DeskApi`.
  - `src/renderer/` — React UI and Galley/CodeMirror integration.
  - `src/shared/` — types and closed contracts shared across process boundaries.
- `packages/pocket-format/` — Pocket Editor wire formats, schemas, UTF-8 byte anchors, availability, and chapter discovery.
- `packages/review-engine/` — pure review model, derived text, editing, signals, apply, and history behavior.
- `packages/book-storage/` — manifests, Markdown/sidecar pairs, save queues, journals, recovery, and book management.
- `tests/desktop/` — real Electron Playwright tests. These create native windows and are subject to the virtual-display rule below.
- `tests/contracts/` — Kotlin/TypeScript compatibility fixtures and pinned related-repository revisions.
- `scripts/` — contract and release orchestration.
- `docs/` — user/development documentation, ADRs, plans, verification evidence, and release runbooks.
- `security.md` — Electron security model and current verification boundaries.

Keep package boundaries intact. The three library packages must not import Electron or React. Renderer code must not import Node-only packages such as `node:crypto` or filesystem APIs.

## Related repositories

Related projects are sibling directories under `../` from this repository:

- `../pocket-editor` — Kotlin/Android Pocket Editor. It is the cross-language authority for review sidecars, manifests, anchors, availability, and exchange-contract behavior.
- `../galley-editor` — source repository for `@inkyquill/galley-editor` and `@inkyquill/galley-themes`. Galley Desk normally consumes the exact published versions pinned in `apps/desktop/package.json`; do not silently replace them with workspace links.
- `../galley-pad` — Tauri desktop Markdown editor and another Galley Editor consumer. Use it when checking shared editor behavior or cross-application compatibility, not as Galley Desk source code.
- `../creative-writing-skills` — related writing-tooling/plugin repository, but not a Galley Desk runtime dependency.

Other sibling repositories may also exist; inspect `../` when a task explicitly spans the tool family. Each related repository is independent, may have its own `AGENTS.md`, branch, dirty state, build system, and release process. Do not edit or commit a sibling repository unless the task explicitly requires cross-repository work.

For compatibility work, `tests/contracts/baseline.json` contains the pinned source revisions. Historical tables in `docs/compatibility.md` may describe older snapshots; current package pins and the baseline file are the executable sources of truth. A deliberate compatibility update must update implementation, fixtures/schemas where applicable, the baseline, and compatibility documentation together.

## Setup and common commands

Run commands from the repository root.

```bash
npm ci                  # install exactly from package-lock.json
npm start               # Electron Forge development mode; GUI isolation still applies
npm run typecheck       # TypeScript project-reference build
npm test                # Vitest unit tests in packages/ and apps/
npm run test:contracts  # Kotlin <-> TypeScript exchange tests; requires JDK 17
npm audit               # dependency audit, including build tools
npm run package         # package current platform into apps/desktop/out/
npm run test:desktop    # Playwright Electron suite; package first and use Xvfb on Linux
```

Focused unit tests can be run by path:

```bash
npm test -- packages/pocket-format/src/anchors.test.ts
npm test -- apps/desktop/src/renderer/editor/markers.test.ts
```

Focused desktop tests still require the isolated GUI wrapper:

```bash
scripts/gui-test.sh npx playwright test tests/desktop/review-actions.spec.ts --workers=1
scripts/gui-test.sh npx playwright test tests/desktop/review-actions.spec.ts -g "test name" --workers=1
```

`npm run test:contracts` needs a valid Pocket Editor checkout. By default the script expects the pinned checkout under `.cache/contracts/pocket-editor`; `POCKET_EDITOR_DIR=../pocket-editor` is allowed only when that checkout contains the required exchange test and is intentionally at the pinned revision.

## Mandatory GUI test isolation

- **Never launch Electron, Playwright Electron tests, packaged smoke tests, visual checks, screenshot capture, Openbox, or any other GUI process on the user's real display.** These processes steal focus and interrupt the user's work.
- On Linux, every GUI run, including `npm start`, must use its own isolated virtual display through `Xvfb`. Unset `XAUTHORITY`, `WAYLAND_DISPLAY`, and `XDG_SESSION_TYPE`; never reuse the `DISPLAY` of the active desktop session.
- Pin `ELECTRON_OZONE_PLATFORM_HINT=x11` for every GUI run. With the session default `auto`, Electron tries Wayland first and escapes to the user's real compositor via the default `$XDG_RUNTIME_DIR/wayland-0` socket — even when `DISPLAY` points at Xvfb. Unsetting `WAYLAND_DISPLAY` alone does NOT prevent this.
- Run Electron tests serially (`--workers=1`), because native windows share keyboard focus even under Xvfb.
- Focused Playwright commands, performance runs, packaged-app tests, and visual-capture scripts must all be placed inside the same `xvfb-run`/Openbox wrapper.
- If an isolated virtual display cannot be started, stop GUI verification and report it as `NOT RUN`. Never fall back to the physical display.
- Older documentation or evidence that mentions `DISPLAY=:0`, the current desktop `DISPLAY`/`XAUTHORITY`, or launching against the active KDE/Xwayland session is historical and must not be followed. This section overrides it.
- Unit tests, type checks, contract checks, and other processes that do not create windows may run normally.

Use the canonical wrapper `scripts/gui-test.sh <command> [args...]`, which applies this Linux pattern:

```bash
env -u XAUTHORITY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE -u NO_COLOR -u FORCE_COLOR \
  ELECTRON_OZONE_PLATFORM_HINT=x11 \
  GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module \
  xvfb-run -a sh -c '
    openbox >/tmp/galley-test-openbox.log 2>&1 &
    galley_wm_pid=$!
    trap "kill $galley_wm_pid 2>/dev/null || true" EXIT
    npm run test:desktop -- --workers=1
  '
```

Set `GALLEY_PACKAGED_EXECUTABLE` inside or before this isolated command when testing `apps/desktop/out/galley-desk-linux-x64/galley-desk`. Linux visual/native prerequisites are `Xvfb`, Openbox, `xdotool`, and `xprop`. See `docs/runbooks/release.md`, but retain the isolation override above.

## Testing expectations

- Start with the smallest relevant unit or Electron test, then run the affected suite. Run the full validation gate in proportion to the change.
- A normal final gate is: `npm run typecheck`, `npm test`, `npm run test:contracts` when formats/contracts are touched, `npm audit` and IPC/window/resource tests when Electron boundaries change, `npm run package`, and the affected desktop tests under Xvfb.
- Desktop tests execute packaged Forge output; run `npm run package` before them when build output may be stale.
- Performance is opt-in and must run alone: `GALLEY_PERF=1 npx playwright test tests/desktop/performance.spec.ts --workers=1`, under the isolated display wrapper.
- Do not increase timeouts, add retries, or weaken assertions merely to turn a flaky/failing test green. Diagnose the failure and record unavailable platform checks as `NOT RUN`.
- Use temporary books and isolated `GALLEY_DESK_USER_DATA` profiles. Never run destructive or write-capable tests against a user's real book directory.
- Preserve exact Markdown and sidecar bytes in regression tests unless the scenario explicitly applies a change. For safety-sensitive changes, compare files before and after.
- Linux/Xvfb success does not prove macOS-native IME, clipboard, picker, traffic-light, signing, or notarization behavior. Do not claim unperformed platform checks.

## Data and compatibility invariants

- Markdown plus its adjacent review sidecar is the portable source of truth. Recovery journals and temporary files belong in application data, not the book directory.
- Pocket offsets are UTF-8 byte offsets; renderer/editor positions are UTF-16. Convert at the established model boundary and test non-ASCII, surrogate pairs, BOM, CRLF, and EOF.
- Do not normalize source bytes, extend Pocket schemas with Desk-only fields, or hand-edit copied schemas without matching cross-language contract work.
- Unavailable and conflicting records must be preserved and shown, not silently discarded. Conflicting edits do not participate in derived text.
- All writes must retain save-queue ordering, revision/conflict checks, recovery behavior, and explicit flush on close. Never bypass `BookService`/`ChapterSession` with renderer-side filesystem access.
- Applying a review edit to Markdown is explicit user intent. Normal typing creates/updates review state; it must not silently rewrite canonical Markdown.
- Diagnostics must never contain manuscript text, comments, YAML, book titles, arbitrary user paths, or raw unknown error messages.

## Electron security boundary

- Treat the renderer as untrusted. Keep `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- Expose only typed, task-specific methods through `DeskApi`; never expose `ipcRenderer`, Electron objects, arbitrary filesystem operations, or generic invoke channels.
- Validate the sender, argument shape, IDs, revisions, enums, ranges, and URLs again in main. Renderer validation is usability, not security.
- Main owns filesystem paths. Prefer opaque `bookId`/`chapterId` arguments and resolve paths through the open-book registry; never accept an arbitrary renderer-provided path for `shell.openPath`, deletion, or resource loading.
- External navigation is restricted to validated HTTP(S); new windows and browser permissions remain denied.
- Keep the `bookres:` protocol constrained to safe image types and files under the open book root.
- Electronegativity was removed because it is unmaintained. Use dependency audit and the unit/runtime boundary tests described in `security.md`; do not treat them as a complete SAST scan.

## Code style and implementation guidance

- TypeScript is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Prefer explicit types at process and persistence boundaries, discriminated unions, narrowing, and `import type` where appropriate.
- Do not introduce `any`, unchecked casts, suppressed errors, or new dependencies to avoid modeling a contract. Validate unknown data at the boundary.
- Follow the local file's formatting and naming. The project uses ESM, single quotes, semicolons, React function components, and focused helpers rather than new framework layers.
- Keep pure format/model logic in packages and platform/UI orchestration in `apps/desktop`. Do not move general Galley Editor behavior into Desk unless it is genuinely Desk-specific; cross-consumer editor behavior belongs in `../galley-editor`.
- Preserve established accessibility behavior: semantic roles, stable accessible names, keyboard access, focus restoration, themed tooltips, and no pointer-only actions.
- Keep responsive layout, Zen, selection, scroll position, IME composition, Undo/Redo, and pending save behavior in mind when changing editor or overlay code.
- Add or update focused tests with behavior changes. Regression tests should assert document contents and relevant geometry/state, not only that an element exists.
- There is no general lint script. `npm run typecheck`, Vitest, focused Electron tests, and `git diff --check` are the minimum mechanical checks.

## Working tree and documentation discipline

- The working tree may contain user or other-agent changes. Inspect `git status`, preserve unrelated edits, and do not reset, overwrite, reformat, or commit work outside the task.
- Plans live in `docs/superpowers/plans/`; verification reports and screenshots belong under `docs/reviews/` or `docs/reviews/evidence/`. Do not claim a plan item or platform check is complete without current evidence.
- Treat old reviews and archived plans as historical evidence, not current instructions. Current code, tests, package pins, active specs, and this file take precedence.
- Use Conventional Commit-style messages consistent with repository history (`fix(scope): ...`, `feat(scope): ...`, `test: ...`, `docs: ...`). Do not create commits, tags, releases, or sibling-repository changes unless the user requested them.

## Packaging and release

- `npm run package` creates unpacked platform output under `apps/desktop/out/`.
- `npm run make --workspace @galley-desk/desktop` creates Linux ZIP/deb/rpm or macOS ZIP according to platform and installed maker prerequisites.
- The application is currently unsigned/not notarized on macOS. Do not claim otherwise and do not add signing credentials to the repository.
- Releases require a clean intended tree, green applicable checks, updated `docs/verification.md`, compatible related-project pins, and the process in `docs/runbooks/release.md`.
- Packaging is not a release. Do not tag or publish unless explicitly asked.
