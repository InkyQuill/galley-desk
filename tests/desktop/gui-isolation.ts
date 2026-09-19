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
 *  - an actual `Xvfb` process is currently serving that exact display
 *    (the real desktop server is Xwayland/kwin; its command line never
 *    contains the `Xvfb` binary name, so the discriminator is safe).
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

function isolationError(reason: string): Error {
  return new Error(
    [
      `Запуск GUI-тестов запрещён (GUI test run refused): ${reason}`,
      'AGENTS.md, раздел «Mandatory GUI test isolation»: любой GUI-запуск (Electron, Playwright,',
      'openbox, скриншоты) обязан выполняться в изолированном виртуальном дисплее Xvfb с unset',
      'XAUTHORITY и WAYLAND_DISPLAY и никогда — на реальном дисплее пользователя.',
      'AGENTS.md, section "Mandatory GUI test isolation": every GUI run must happen inside an',
      'isolated virtual display; never on the user\'s real desktop.',
      '',
      'Canonical wrapper (используйте его):',
      '  scripts/gui-test.sh npx playwright test tests/desktop/shell.spec.ts --workers=1',
    ].join('\n'),
  );
}

/**
 * Throws unless the current process is provably inside the AGENTS.md-isolated
 * virtual display. `env` and `readPsArgs` are injectable for unit tests.
 */
export function assertIsolatedVirtualDisplay(
  env: NodeJS.ProcessEnv = process.env,
  readPsArgs: PsArgsReader = defaultReadPsArgs,
): void {
  const display = parseDisplayNumber(env.DISPLAY);
  if (display === null) {
    throw isolationError(
      `DISPLAY is not set or unparseable (DISPLAY=${JSON.stringify(env.DISPLAY) ?? 'undefined'}).`,
    );
  }

  const wayland = env.WAYLAND_DISPLAY;
  if (typeof wayland === 'string' && wayland !== '') {
    throw isolationError(
      `WAYLAND_DISPLAY is set («${wayland}») — this is the user's real Wayland session, not an isolated Xvfb.`,
    );
  }

  if (!hasXvfbForDisplay(readPsArgs(), display)) {
    throw isolationError(
      `no Xvfb process is currently serving :${display} (checked \`ps -eo args\`); ` +
        'the display is not an isolated virtual one.',
    );
  }
}

/** Playwright globalSetup entry point: runs once before any project/test starts. */
export default function guiIsolationGlobalSetup(_config: FullConfig): void {
  assertIsolatedVirtualDisplay(process.env, defaultReadPsArgs);
}
