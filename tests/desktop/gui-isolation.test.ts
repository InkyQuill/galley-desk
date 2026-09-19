import { describe, expect, it } from 'vitest';
import {
  assertIsolatedVirtualDisplay,
  hasXvfbForDisplay,
  parseDisplayNumber,
  type PsArgsReader,
} from './gui-isolation';

/** A ps snapshot that must never satisfy the guard: the user's real Xwayland/kwin session. */
const REAL_SESSION_PS = [
  '/usr/bin/kwin_wayland_wrapper --xwayland',
  '/usr/bin/kwin_wayland --wayland-fd 7 --socket wayland-0 --xwayland-display :0 --xwayland',
  '/usr/bin/Xwayland :0 -auth /run/user/1000/xauth_SCnBKZ -listenfd 8 -rootless',
  'xvfb-run -a sh -c \'openbox & "$@"\' sh npx playwright test',
].join('\n');

const XVFB_99_PS = [
  REAL_SESSION_PS,
  '/usr/bin/Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp -auth /tmp/xvfb-auth',
].join('\n');

/** Reader used where the guard must refuse BEFORE ever needing the process list. */
const psMustNotBeRead: PsArgsReader = () => {
  throw new Error('ps must not be read for environment-level refusals');
};

describe('parseDisplayNumber', () => {
  it('parses DISPLAY values robustly', () => {
    expect(parseDisplayNumber(':99')).toBe(99);
    expect(parseDisplayNumber(':0')).toBe(0);
    expect(parseDisplayNumber(':99.0')).toBe(99);
    expect(parseDisplayNumber('99')).toBe(99);
    expect(parseDisplayNumber(' :7.15 ')).toBe(7);
  });

  it('rejects unset or malformed DISPLAY values', () => {
    expect(parseDisplayNumber(undefined)).toBeNull();
    expect(parseDisplayNumber(null)).toBeNull();
    expect(parseDisplayNumber('')).toBeNull();
    expect(parseDisplayNumber(':')).toBeNull();
    expect(parseDisplayNumber(':abc')).toBeNull();
    expect(parseDisplayNumber('host:name')).toBeNull();
  });
});

describe('hasXvfbForDisplay (ps -eo args matcher)', () => {
  it('matches an actual Xvfb process serving the exact display', () => {
    expect(hasXvfbForDisplay(XVFB_99_PS, 99)).toBe(true);
    expect(hasXvfbForDisplay('Xvfb :9 -screen 0 640x480x8', 9)).toBe(true);
    expect(hasXvfbForDisplay('/usr/libexec/Xvfb :1', 1)).toBe(true);
  });

  it('never matches the real Xwayland/kwin server or look-alike processes', () => {
    expect(hasXvfbForDisplay(REAL_SESSION_PS, 0)).toBe(false);
    expect(hasXvfbForDisplay(REAL_SESSION_PS, 99)).toBe(false);
    expect(hasXvfbForDisplay('', 0)).toBe(false);
  });

  it('respects display-number boundaries', () => {
    // `Xvfb :9` must not satisfy DISPLAY=':99' and vice versa.
    expect(hasXvfbForDisplay('Xvfb :9', 99)).toBe(false);
    expect(hasXvfbForDisplay('Xvfb :99', 9)).toBe(false);
    expect(hasXvfbForDisplay('Xvfb :99.0', 99)).toBe(true);
    expect(hasXvfbForDisplay('Xvfb :999', 99)).toBe(false);
  });
});

describe('assertIsolatedVirtualDisplay refusal branches', () => {
  it('refuses when DISPLAY is unset, without reading ps', () => {
    expect(() =>
      assertIsolatedVirtualDisplay({ WAYLAND_DISPLAY: undefined }, psMustNotBeRead),
    ).toThrow(/AGENTS\.md[\s\S]*DISPLAY/s);
  });

  it('refuses when WAYLAND_DISPLAY is set (real Wayland session), without reading ps', () => {
    expect(() =>
      assertIsolatedVirtualDisplay(
        { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' },
        psMustNotBeRead,
      ),
    ).toThrow(/WAYLAND_DISPLAY is set/);
  });

  it('refuses when no Xvfb process serves the requested display', () => {
    const readRealSession: PsArgsReader = () => REAL_SESSION_PS;
    expect(() =>
      assertIsolatedVirtualDisplay(
        {
          DISPLAY: ':99',
          WAYLAND_DISPLAY: undefined,
          ELECTRON_OZONE_PLATFORM_HINT: 'x11',
          XDG_SESSION_TYPE: undefined,
        },
        readRealSession,
      ),
    ).toThrow(/no Xvfb process is currently serving :99/);
  });

  it('refuses when ELECTRON_OZONE_PLATFORM_HINT is not exactly x11 (ozone wayland escape)', () => {
    // The user's real session value: 'auto' lets Electron connect to the default
    // wayland-0 socket of the real compositor even under a correct Xvfb DISPLAY.
    for (const hint of ['auto', 'wayland', undefined]) {
      expect(() =>
        assertIsolatedVirtualDisplay(
          {
            DISPLAY: ':99',
            WAYLAND_DISPLAY: undefined,
            ELECTRON_OZONE_PLATFORM_HINT: hint,
            XDG_SESSION_TYPE: undefined,
          },
          psMustNotBeRead,
        ),
      ).toThrow(hint === undefined ? /ELECTRON_OZONE_PLATFORM_HINT must be exactly 'x11', found unset/ : new RegExp(`ELECTRON_OZONE_PLATFORM_HINT must be exactly 'x11', found «${hint}»`));
    }
    // The refusal explains the escape route.
    let message = '';
    try {
      assertIsolatedVirtualDisplay(
        {
          DISPLAY: ':99',
          WAYLAND_DISPLAY: undefined,
          ELECTRON_OZONE_PLATFORM_HINT: 'auto',
          XDG_SESSION_TYPE: undefined,
        },
        psMustNotBeRead,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('wayland-0');
    expect(message).toContain('real');
  });

  it('refuses when XDG_SESSION_TYPE is wayland', () => {
    expect(() =>
      assertIsolatedVirtualDisplay(
        {
          DISPLAY: ':99',
          WAYLAND_DISPLAY: undefined,
          ELECTRON_OZONE_PLATFORM_HINT: 'x11',
          XDG_SESSION_TYPE: 'wayland',
        },
        psMustNotBeRead,
      ),
    ).toThrow(/XDG_SESSION_TYPE is 'wayland'/);
  });

  it('allows a run inside the isolated virtual display and names the wrapper otherwise', () => {
    const readXvfb99: PsArgsReader = () => XVFB_99_PS;
    expect(() =>
      assertIsolatedVirtualDisplay(
        {
          DISPLAY: ':99',
          WAYLAND_DISPLAY: undefined,
          ELECTRON_OZONE_PLATFORM_HINT: 'x11',
          XDG_SESSION_TYPE: 'x11',
        },
        readXvfb99,
      ),
    ).not.toThrow();

    let message = '';
    try {
      assertIsolatedVirtualDisplay({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }, psMustNotBeRead);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('AGENTS.md');
    expect(message).toContain('Mandatory GUI test isolation');
    expect(message).toContain('scripts/gui-test.sh');
  });
});
