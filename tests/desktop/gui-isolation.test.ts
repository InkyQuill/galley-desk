import { describe, expect, it } from 'vitest';
import { assertIsolatedVirtualDisplay, hasXvfbForDisplay, parseDisplayNumber } from './gui-isolation';

const env = { DISPLAY: ':99', ELECTRON_OZONE_PLATFORM_HINT: 'x11' };
const readXvfb = () => '/usr/bin/Xvfb :99 -screen 0 1280x1024x24';
const psMustNotBeRead = () => { throw new Error('unexpected ps read'); };

describe('local DISPLAY parsing', () => {
  it.each([':99', ':99.0'])('accepts %s', display => {
    expect(parseDisplayNumber(display)).toBe(99);
  });
  it.each([undefined, null, '', '99', ':abc', ' :99 ', 'remote-host:99', 'localhost:99.0'])('rejects %s', display => {
    expect(parseDisplayNumber(display)).toBeNull();
  });
});

describe('GUI isolation', () => {
  it.each([
    [{ ...env, DISPLAY: undefined }, /DISPLAY/],
    [{ ...env, DISPLAY: 'remote-host:99' }, /DISPLAY/],
    [{ ...env, WAYLAND_DISPLAY: 'wayland-0' }, /WAYLAND_DISPLAY/],
    [{ ...env, ELECTRON_OZONE_PLATFORM_HINT: undefined }, /ELECTRON_OZONE_PLATFORM_HINT/],
    [{ ...env, ELECTRON_OZONE_PLATFORM_HINT: 'auto' }, /ELECTRON_OZONE_PLATFORM_HINT/],
    [{ ...env, XDG_SESSION_TYPE: 'wayland' }, /XDG_SESSION_TYPE/],
  ])('rejects unsafe environment %j before probing processes', (unsafeEnv, reason) => {
    expect(() => assertIsolatedVirtualDisplay(unsafeEnv, psMustNotBeRead)).toThrow(reason);
  });

  it('allows the requested Xvfb and rejects a real or different display', () => {
    expect(() => assertIsolatedVirtualDisplay(env, readXvfb)).not.toThrow();
    for (const ps of ['/usr/bin/Xwayland :99', '/usr/bin/kwin_wayland --xwayland-display :99', 'Xvfb :9', 'Xvfb :999', '']) {
      expect(() => assertIsolatedVirtualDisplay(env, () => ps)).toThrow(/no Xvfb/);
    }
    expect(hasXvfbForDisplay('Xvfb :99', 9)).toBe(false);
  });

  it('gives platform-appropriate remediation', () => {
    expect(() => assertIsolatedVirtualDisplay({}, psMustNotBeRead, 'linux')).toThrow(/scripts\/gui-test.sh/);
    expect(() => assertIsolatedVirtualDisplay({}, psMustNotBeRead, 'darwin')).toThrow(/macOS GUI runs are unsupported/);
  });
});
