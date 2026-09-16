/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
import { app, BrowserWindow, dialog, protocol, shell } from 'electron';
import path from 'node:path';
import { createBookService } from './book-service';
import { flushRenderer, resumeRenderer, isOwnRendererUrl, registerDeskIpc } from './ipc';
import { BOOK_RESOURCE_SCHEME, parseBookResourceUrl, resolveBookImage } from './resources';

// Глобальные константы создаёт Forge Vite plugin на этапе сборки:
// в dev это URL dev-сервера, в упакованном приложении — undefined,
// и загружается собранный renderer из .vite/renderer/main_window.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Схема локальных картинок открытых книг: стандартный, «безопасный»
// протокол с доступом к fetch API; его ответы минуют CSP страницы,
// поэтому обработчик сам пропускает только разрешённые изображения
// из открытого корня (resources.ts) и ставит nosniff.
protocol.registerSchemesAsPrivileged([
  {
    scheme: BOOK_RESOURCE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// Desktop-тесты подменяют профиль: отдельный temp userData на каждый тест.
// Продуктового тестового API для произвольных путей нет и не появляется.
const userDataOverride = process.env.GALLEY_DESK_USER_DATA;
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

// Повторная проверка внешних изменений (фокус окна): сервис появляется
// после whenReady, поэтому подписка идёт через инъекцию.
let recheckExternal: (() => void) | null = null;
let closeWindow: ((window: BrowserWindow) => void) | null = null;
let quitFlushed = false;

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

  // Local book review needs no browser permissions (camera, microphone,
  // notifications, location). Deny both requests and permission probes.
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);

  mainWindow.on('close', (event) => {
    if (quitFlushed) return;
    event.preventDefault();
    closeWindow?.(mainWindow);
  });

  // window.open и любое внешнее открытие запрещены.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Повторная проверка внешних изменений при возврате фокуса: наблюдатель —
  // только сигнал, проверку выполняют сессии (checkExternal).
  mainWindow.on('focus', () => {
    recheckExternal?.();
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnRendererUrl(url)) {
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

  app.whenReady().then(() => {
    const service = createBookService({
      appData: app.getPath('userData'),
      chooseDirectory: async () => {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      chooseExportDestination: async (suggestedName) => {
        const result = await dialog.showSaveDialog({ defaultPath: suggestedName });
        return result.canceled ? null : (result.filePath ?? null);
      },
    });

    protocol.handle(BOOK_RESOURCE_SCHEME, async (request) => {
      // Все ответы с CORS «*»: схема отдаёт только картинки открытых книг,
      // а fetch из renderer требует CORS-заголовок для чужого origin.
      const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };
      const parsed = parseBookResourceUrl(request.url);
      if (parsed === null) {
        return new Response(null, { status: 403, headers });
      }
      const root = service.getBookRoot(parsed.bookId);
      if (root === undefined) {
        return new Response(null, { status: 404, headers });
      }
      const image = await resolveBookImage(root, parsed.relPath);
      if (image === null) {
        return new Response(null, { status: 404, headers });
      }
      // Uint8Array — корректное тело ответа для undici; приведение нужно
      // только из-за расхождения DOM-типов BufferSource с новым generics.
      return new Response(image.bytes as unknown as BodyInit, {
        headers: {
          ...headers,
          'Content-Type': image.mime,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    });

    registerDeskIpc({
      service,
      // Обёртка (а не ссылка на метод): подмена shell.openExternal в тестах
      // перехватывается, так как свойство читается в момент вызова.
      openExternal: (url) => shell.openExternal(url),
      broadcast: (snapshot) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('desk:snapshot', snapshot);
        }
      },
    });
    recheckExternal = () => {
      void service.recheckExternal();
    };

    let closing: Promise<void> | null = null;
    const prepareClose = (): Promise<void> => {
      if (closing !== null) return closing;
      closing = (async () => {
        const windows = BrowserWindow.getAllWindows();
        try {
          await Promise.all(windows.map(window => flushRenderer(window.webContents)));
          await service.closeAll();
        } catch (error) {
          for (const window of windows) resumeRenderer(window.webContents);
          console.error('[desk] close: code=SAVE_FAILED');
          throw error;
        } finally {
          closing = null;
        }
      })();
      return closing;
    };
    closeWindow = (window) => {
      // Window close on macOS keeps the process alive; quit is a separate intent.
      void prepareClose().then(() => {
        if (!window.isDestroyed()) window.destroy();
      }, () => undefined);
    };
    let quitting = false;
    app.on('before-quit', (event) => {
      if (quitFlushed) return;
      event.preventDefault();
      if (quitting) return;
      quitting = true;
      void prepareClose().then(() => {
        quitFlushed = true;
        app.quit();
      }, () => { quitting = false; });
    });

    createWindow();
  });

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
