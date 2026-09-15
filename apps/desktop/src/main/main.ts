/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

// Глобальные константы создаёт Forge Vite plugin на этапе сборки:
// в dev это URL dev-сервера, в упакованном приложении — undefined,
// и загружается собранный renderer из .vite/renderer/main_window.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // window.open и любое внешнее открытие запрещены.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Навигация из локального Markdown (и любой другой уход со страницы
  // приложения) запрещена; внешние ссылки позже пойдут через shell.openExternal.
  const ownPrefix =
    MAIN_WINDOW_VITE_DEV_SERVER_URL ??
    `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`)}`;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ownPrefix)) {
      event.preventDefault();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// Один процесс Galley Desk на профиль: второй запуск не создаёт
// независимого writer, а фокусирует существующее окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
