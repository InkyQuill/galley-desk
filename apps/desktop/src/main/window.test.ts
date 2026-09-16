import { describe, expect, test, vi } from 'vitest';
import { buildMainWindowOptions, runWindowAction } from './window';

describe('main window chrome', () => {
  test('Linux uses the custom frame, packaged icon and existing preload isolation', () => {
    const options = buildMainWindowOptions('linux', '/app/preload.js', '/app/icon.png');
    expect(options).toMatchObject({
      frame: false,
      icon: '/app/icon.png',
      webPreferences: {
        preload: '/app/preload.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });

  test('macOS keeps traffic lights in an inset hidden title bar', () => {
    const options = buildMainWindowOptions('darwin', '/app/preload.js', '/app/icon.png');
    expect(options.frame).not.toBe(false);
    expect(options).toMatchObject({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 13 },
    });
  });
});

test('window actions toggle state and close through BrowserWindow.close', () => {
  let maximized = false;
  const window = {
    minimize: vi.fn(),
    maximize: vi.fn(() => { maximized = true; }),
    unmaximize: vi.fn(() => { maximized = false; }),
    close: vi.fn(),
    isMaximized: () => maximized,
  };
  expect(runWindowAction(window, 'minimize')).toMatchObject({ maximized: false });
  expect(runWindowAction(window, 'toggle-maximize')).toMatchObject({ maximized: true });
  expect(runWindowAction(window, 'toggle-maximize')).toMatchObject({ maximized: false });
  expect(runWindowAction(window, 'close')).toMatchObject({ maximized: false });
  expect(window.minimize).toHaveBeenCalledOnce();
  expect(window.maximize).toHaveBeenCalledOnce();
  expect(window.unmaximize).toHaveBeenCalledOnce();
  expect(window.close).toHaveBeenCalledOnce();
});

test('window actions reject arbitrary values', () => {
  expect(() => runWindowAction({} as never, 'destroy' as never)).toThrow('Unknown window action');
});
