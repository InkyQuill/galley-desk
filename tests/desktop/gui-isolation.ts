import { execFileSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

// Refuse GUI launches outside Linux/Xvfb before Playwright starts any tests.
// Pin x11 as Electron can otherwise connect to the real Wayland compositor.
export type PsArgsReader = () => string;

export function defaultReadPsArgs(): string {
  return execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
}

export function parseDisplayNumber(display: string | undefined | null): number | null {
  if (typeof display !== 'string') {
    return null;
  }
  const match = /^:(\d+)(?:\.\d+)?$/.exec(display);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(value) ? value : null;
}

const XVFB_TOKEN = /(?:^|[\s/])Xvfb(?:\s|$)/;

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
    `GUI test run refused: ${reason}`,
    'AGENTS.md: Mandatory GUI test isolation requires Linux/Xvfb.',
    platform === 'linux'
      ? 'Use scripts/gui-test.sh <command> [args...].'
      : 'macOS GUI runs are unsupported by this harness; GUI checks are NOT RUN.',
  ];
  return new Error(lines.join('\n'));
}

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

  const ozoneHint = env.ELECTRON_OZONE_PLATFORM_HINT;
  if (ozoneHint !== 'x11') {
    throw isolationError(
      "ELECTRON_OZONE_PLATFORM_HINT must be exactly 'x11' to prevent Wayland fallback.",
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

export default function guiIsolationGlobalSetup(_config: FullConfig): void {
  assertIsolatedVirtualDisplay(process.env, defaultReadPsArgs);
}
