import type { BrowserWindowConstructorOptions } from 'electron';
import type { WindowAction, WindowState } from '../shared/api';

type WindowController = {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isMaximized(): boolean;
};

export function buildMainWindowOptions(platform: NodeJS.Platform, preload: string, icon: string): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 850,
    minWidth: 720,
    minHeight: 520,
    ...(platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } }
      : { frame: false }),
    icon,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
}

export function runWindowAction(window: WindowController, action: WindowAction): WindowState {
  switch (action) {
    case 'minimize': window.minimize(); break;
    case 'toggle-maximize':
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      break;
    case 'close':
      // Emits the existing guarded close event; destroy would bypass flush.
      window.close();
      break;
    default: throw new TypeError('Unknown window action');
  }
  return { maximized: window.isMaximized(), platform: process.platform };
}

export function readWindowState(window: Pick<WindowController, 'isMaximized'>): WindowState {
  return { maximized: window.isMaximized(), platform: process.platform };
}
