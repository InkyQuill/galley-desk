/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
import { app, BrowserWindow, dialog, Menu, protocol, shell } from 'electron';
import path from 'node:path';
import { createBookService } from './book-service';
import { createLogger } from './diagnostics/logger';
import type { Logger } from './diagnostics/logger';
import { safeError } from './diagnostics/safe-error';
import { flushRenderer, resumeRenderer, isOwnRendererUrl, registerDeskIpc } from './ipc';
import { BOOK_RESOURCE_SCHEME, parseBookResourceUrl, resolveBookImage } from './resources';
import { buildMainWindowOptions, readWindowState, runWindowAction } from './window';

// Глобальные константы создаёт Forge Vite plugin на этапе сборки:
// в dev это URL dev-сервера, в упакованном приложении — undefined,
// и загружается собранный renderer из .vite/renderer/main_window.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
// forge.config.ts injects the short git revision at build time (see
// vite.main.config.ts's `define`); a source archive without .git falls back
// to 'unknown' -- never resolved at runtime by shelling out to git.
declare const BUILD_REVISION: string;

// Versions of the vendored editor/themes packages, pinned exactly in
// package.json (never a semver range): kept here as a plain constant rather
// than resolved at runtime so the packaged asar never needs to read another
// package's package.json. Bump alongside the dependency version.
const EDITOR_VERSION = '0.15.0';
const THEMES_VERSION = '0.15.0';

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
  const icon = app.isPackaged
    ? path.join(process.resourcesPath, 'branding', 'generated', 'galley-desk-icon.png')
    : path.resolve(__dirname, '../../assets/branding/generated/galley-desk-icon.png');
  const mainWindow = new BrowserWindow(buildMainWindowOptions(process.platform, path.join(__dirname, 'preload.js'), icon));

  const publishWindowState = (): void => {
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('desk:window-state-changed', readWindowState(mainWindow));
    }
  };
  mainWindow.on('maximize', publishWindowState);
  mainWindow.on('unmaximize', publishWindowState);

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
  // Created right after the userData override and the single-instance lock,
  // before any service or window: every later failure (IPC, book service,
  // renderer crash, uncaught exception) has somewhere to go. A logger that
  // fails to initialize degrades to `unavailable` internally (see
  // diagnostics/logger.ts) -- it never throws and never blocks the app.
  const logger: Logger = createLogger(path.join(app.getPath('userData'), 'logs'), {
    appVersion: app.getVersion(),
    build: typeof BUILD_REVISION === 'string' ? BUILD_REVISION : 'unknown',
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    editor: EDITOR_VERSION,
    themes: THEMES_VERSION,
    platform: process.platform,
    arch: process.arch,
  });
  logger.write({ event: 'session-start', level: 'info', process: 'main' });

  // Observes only -- never suppresses Node's normal fatal-crash behavior.
  // A handler on 'uncaughtException' (not 'uncaughtExceptionMonitor') would
  // prevent the default crash; this deliberately stays a monitor.
  process.on('uncaughtExceptionMonitor', (error) => {
    logger.fatal({ event: 'uncaught-main', level: 'error', process: 'main', ...safeError(error) });
  });

  // Only the closed enum reason/exit code is stored -- never a message, URL
  // or any other detail carried on the event.
  app.on('render-process-gone', (_event, _webContents, details) => {
    logger.write({ event: 'renderer-gone', level: 'error', process: 'main', code: `${details.reason}(${details.exitCode})` });
  });
  app.on('child-process-gone', (_event, details) => {
    logger.write({ event: 'child-gone', level: 'error', process: 'main', code: `${details.type}:${details.reason}(${details.exitCode})` });
  });

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
    // Frameless Linux chrome must not retain Electron's Alt-activated menu.
    // macOS keeps the conventional application menu and keyboard roles.
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    const service = createBookService({
      appData: app.getPath('userData'),
      logger,
      trashItem: (target) => shell.trashItem(target),
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
      logger,
      // Обёртка (а не ссылка на метод): подмена shell.openExternal в тестах
      // перехватывается, так как свойство читается в момент вызова.
      openExternal: (url) => shell.openExternal(url),
      windowState: (contents) => {
        const window = BrowserWindow.fromWebContents(contents);
        if (window === null) throw new Error('Window missing');
        return readWindowState(window);
      },
      windowAction: (contents, action) => {
        const window = BrowserWindow.fromWebContents(contents);
        if (window === null) throw new Error('Window missing');
        return runWindowAction(window, action);
      },
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
          logger.write({ event: 'close-failed', level: 'error', process: 'main', code: 'SAVE_FAILED' });
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
      void prepareClose().then(async () => {
        quitFlushed = true;
        // The book is already safely flushed above; session-end and the
        // diagnostics flush are best-effort and never delay quit past the
        // 500ms cap -- the crash path makes no promise about the book at all.
        logger.write({ event: 'session-end', level: 'info', process: 'main' });
        await Promise.race([logger.flush(), new Promise<void>((resolve) => setTimeout(resolve, 500))]);
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
