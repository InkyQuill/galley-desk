import { execFileSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

/**
 * Playwright globalSetup guard for AGENTS.md «Mandatory GUI test isolation».
 *
 * Instruction-only enforcement failed: agents repeatedly launched Electron on the
 * user's real desktop display. This guard runs before any test (and therefore
 * before any Electron launch) for every `npx playwright test` invocation and
 * makes an unisolated GUI run technically impossible.
 *
 * The run is allowed only when ALL of the following hold:
 *  - `DISPLAY` is set and parseable;
 *  - `WAYLAND_DISPLAY` is unset (the canonical wrapper unsets it; the user's
 *    real Wayland session has it set);
 *  - `ELECTRON_OZONE_PLATFORM_HINT` is exactly `'x11'` — with `auto` (the user's
 *    session default) Electron tries Wayland FIRST and connects to the default
 *    `$XDG_RUNTIME_DIR/wayland-0` socket, i.e. the user's real compositor, even
 *    when `DISPLAY` points at Xvfb. This escape happens inside Electron's
 *    platform selection and is invisible to the checks above;
 *  - `XDG_SESSION_TYPE` is unset or not `'wayland'` (same ozone Wayland escape
 *    path; the wrapper unsets it);
 *  - an actual `Xvfb` process is currently serving that exact display
 *    (the real desktop server is Xwayland/kwin; its command line never
 *    contains the `Xvfb` binary name, so the discriminator is safe).
 *
 * On a non-Linux host (macOS in practice) no run is possible either: the guard
 * refuses as always, but the refusal says plainly that GUI isolation exists
 * only for Linux/Xvfb and that macOS GUI runs are unsupported by this harness,
 * instead of pointing at the Linux-only wrapper.
 */

/** Returns the raw output of `ps -eo args`. Injectable so tests stay host-independent. */
export type PsArgsReader = () => string;

export function defaultReadPsArgs(): string {
  return execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
}

/** `':99'` → 99, `':99.0'` → 99, `'99'` → 99, `':abc'`/`''`/undefined → null. */
export function parseDisplayNumber(display: string | undefined | null): number | null {
  if (typeof display !== 'string') {
    return null;
  }
  const trimmed = display.trim();
  const colonIndex = trimmed.lastIndexOf(':');
  const digits = colonIndex === -1 ? trimmed : trimmed.slice(colonIndex + 1);
  const match = /^(\d+)(?:\.\d+)?$/.exec(digits);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** The `Xvfb` binary name as a standalone token (start, whitespace, or path separator before it). */
const XVFB_TOKEN = /(?:^|[\s/])Xvfb(?:\s|$)/;

/**
 * True when at least one `ps -eo args` line contains the Xvfb binary name AND the
 * exact display `:<N>`. Token boundaries keep `Xvfb :9` from matching `:99`, and
 * Xwayland/kwin command lines (which never contain the `Xvfb` token) never match.
 */
export function hasXvfbForDisplay(psArgs: string, display: number): boolean {
  const displayPattern = new RegExp(`(?:^|\\s):${display}(?!\\d)`);
  for (const line of psArgs.split('\n')) {
    if (XVFB_TOKEN.test(line) && displayPattern.test(line)) {
      return true;
    }
  }
  return false;
}

function isolationError(reason: string, platform: NodeJS.Platform = process.platform): Error {
  const lines = [
    `Запуск GUI-тестов запрещён (GUI test run refused): ${reason}`,
    'AGENTS.md, раздел «Mandatory GUI test isolation»: любой GUI-запуск (Electron, Playwright,',
    'openbox, скриншоты) обязан выполняться в изолированном виртуальном дисплее Xvfb с unset',
    'XAUTHORITY и WAYLAND_DISPLAY и никогда — на реальном дисплее пользователя.',
    'AGENTS.md, section "Mandatory GUI test isolation": every GUI run must happen inside an',
    'isolated virtual display; never on the user\'s real desktop.',
    '',
  ];
  if (platform === 'linux') {
    lines.push(
      'Canonical wrapper (используйте его):',
      '  scripts/gui-test.sh npx playwright test tests/desktop/shell.spec.ts --workers=1',
    );
  } else {
    // Honesty branch for non-Linux hosts (macOS in practice): the canonical
    // wrapper depends on xvfb-run/openbox and cannot work there. This message
    // is documentation, not an escape hatch — nothing in the harness treats a
    // mac as isolated, and an unsandboxed mac run requires an explicit human
    // decision made outside this harness.
    lines.push(
      'GUI test isolation is implemented only for Linux/Xvfb; this platform is not Linux.',
      'The canonical wrapper (scripts/gui-test.sh) depends on xvfb-run/openbox and cannot',
      'work on macOS: macOS GUI runs are unsupported by this harness. They may run',
      'unsandboxed ONLY if a human explicitly arranges it — this message documents that',
      'decision for a human, it is not an escape hatch.',
    );
  }
  return new Error(lines.join('\n'));
}

/**
 * Throws unless the current process is provably inside the AGENTS.md-isolated
 * virtual display. `env`, `readPsArgs` and `platform` are injectable for unit
 * tests. Refusal logic is identical on every platform; only the remediation
 * half of the refusal message is platform-aware.
 */
export function assertIsolatedVirtualDisplay(
  env: NodeJS.ProcessEnv = process.env,
  readPsArgs: PsArgsReader = defaultReadPsArgs,
  platform: NodeJS.Platform = process.platform,
): void {
  const display = parseDisplayNumber(env.DISPLAY);
  if (display === null) {
    throw isolationError(
      `DISPLAY is not set or unparseable (DISPLAY=${JSON.stringify(env.DISPLAY) ?? 'undefined'}).`,
      platform,
    );
  }

  const wayland = env.WAYLAND_DISPLAY;
  if (typeof wayland === 'string' && wayland !== '') {
    throw isolationError(
      `WAYLAND_DISPLAY is set («${wayland}») — this is the user's real Wayland session, not an isolated Xvfb.`,
      platform,
    );
  }

  // Electron's ozone platform selection can escape a correct DISPLAY: with
  // ELECTRON_OZONE_PLATFORM_HINT=auto (the user's session default) Electron 44
  // tries Wayland FIRST and connects to the DEFAULT socket
  // $XDG_RUNTIME_DIR/wayland-0 — the user's real compositor — even though
  // DISPLAY points at Xvfb. Pinning the hint to 'x11' is therefore mandatory,
  // not cosmetic; the canonical wrapper exports it.
  const ozoneHint = env.ELECTRON_OZONE_PLATFORM_HINT;
  if (ozoneHint !== 'x11') {
    throw isolationError(
      `ELECTRON_OZONE_PLATFORM_HINT must be exactly 'x11', found ` +
        `${ozoneHint === undefined ? 'unset' : `«${ozoneHint}»`}. ` +
        "With 'auto' Electron tries Wayland first and escapes to the user's real " +
        'compositor via the default $XDG_RUNTIME_DIR/wayland-0 socket, even when ' +
        'DISPLAY points at an isolated Xvfb.',
      platform,
    );
  }

  const sessionType = env.XDG_SESSION_TYPE;
  if (sessionType === 'wayland') {
    throw isolationError(
      "XDG_SESSION_TYPE is 'wayland' — together with an unpinned ozone hint this " +
        'lets Electron escape to the real compositor; the canonical wrapper unsets ' +
        'XDG_SESSION_TYPE and pins ELECTRON_OZONE_PLATFORM_HINT=x11.',
      platform,
    );
  }

  if (!hasXvfbForDisplay(readPsArgs(), display)) {
    throw isolationError(
      `no Xvfb process is currently serving :${display} (checked \`ps -eo args\`); ` +
        'the display is not an isolated virtual one.',
      platform,
    );
  }
}

/** Playwright globalSetup entry point: runs once before any project/test starts. */
export default function guiIsolationGlobalSetup(_config: FullConfig): void {
  assertIsolatedVirtualDisplay(process.env, defaultReadPsArgs);
}
