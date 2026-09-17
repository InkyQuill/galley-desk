import { expect, test } from 'vitest';
import { isZenShortcut } from './shortcuts';

type EventLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'>;

const base: EventLike = { code: 'KeyZ', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false };

test.each([
  ['linux: Ctrl+Alt+KeyZ matches', 'linux', { ctrlKey: true, altKey: true }, true],
  ['win32: Ctrl+Alt+KeyZ matches (same guard as linux)', 'win32', { ctrlKey: true, altKey: true }, true],
  ['darwin: Cmd+Alt+KeyZ matches', 'darwin', { metaKey: true, altKey: true }, true],
  // Кириллическая раскладка меняет event.key, но не event.code -- физическая
  // клавиша Z остаётся KeyZ, поэтому проверка сохраняется без изменений.
  ['linux: KeyZ code holds under a non-Latin layout (event.key differs, code does not)', 'linux', { ctrlKey: true, altKey: true, code: 'KeyZ' }, true],
  ['darwin: Ctrl+Alt+KeyZ (wrong modifier for the platform) does not match', 'darwin', { ctrlKey: true, altKey: true }, false],
  ['linux: Cmd+Alt+KeyZ (wrong modifier for the platform) does not match', 'linux', { metaKey: true, altKey: true }, false],
  ['linux: both Ctrl and Meta held does not match', 'linux', { ctrlKey: true, metaKey: true, altKey: true }, false],
  ['darwin: both Ctrl and Meta held does not match', 'darwin', { ctrlKey: true, metaKey: true, altKey: true }, false],
  ['linux: missing Alt does not match', 'linux', { ctrlKey: true }, false],
  ['linux: repeat (held key) does not match', 'linux', { ctrlKey: true, altKey: true, repeat: true }, false],
  ['linux: IME composition in progress does not match', 'linux', { ctrlKey: true, altKey: true, isComposing: true }, false],
  ['linux: wrong physical key (KeyY) does not match', 'linux', { ctrlKey: true, altKey: true, code: 'KeyY' }, false],
  // Redo -- Ctrl/Cmd+Shift+Z -- must never be swallowed by the Zen guard.
  ['linux: Ctrl+Shift+Z (Redo) does not match', 'linux', { ctrlKey: true, shiftKey: true }, false],
  ['darwin: Cmd+Shift+Z (Redo) does not match', 'darwin', { metaKey: true, shiftKey: true }, false],
  ['linux: Ctrl+Alt+Shift+Z (Alt held alongside Redo-like Shift) does not match', 'linux', { ctrlKey: true, altKey: true, shiftKey: true }, false],
  ['darwin: Cmd+Alt+Shift+Z does not match', 'darwin', { metaKey: true, altKey: true, shiftKey: true }, false],
])('%s', (_name, platform, overrides, expected) => {
  const event: EventLike = { ...base, ...overrides };
  expect(isZenShortcut(event, platform as NodeJS.Platform)).toBe(expected);
});
