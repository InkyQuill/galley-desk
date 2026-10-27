// Preload изолированного окна: nodeIntegration отключён, sandbox включён.
// Наружу выходят только явные методы DeskApi — никаких произвольных
// каналов и никаких ссылок на ipcRenderer в контексте страницы.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppearanceSettings,
  BookView,
  ChapterDiscovery,
  Command,
  DeskApi,
  DiagnosticInfo,
  Recent,
  Snapshot,
  WindowState,
} from '../shared/api';
import type { DiagnosticInput } from '../shared/diagnostics';
import type { LayoutSettings } from '../shared/layout';

/** Ответ основного процесса: ошибки приходят конвертом со стабильным кодом. */
type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcEnvelope<T>;
  if (result.ok) return result.value;
  const error = new Error(result.message);
  (error as Error & { code: string }).code = result.code;
  throw error;
}

const closeListeners = new Set<(closing: boolean) => Promise<void>>();
ipcRenderer.on('desk:flush-request', async (_event, requestId: string | null) => {
  try {
    await Promise.all([...closeListeners].map(listener => listener(requestId !== null)));
    if (requestId !== null) ipcRenderer.send('desk:flush-ack', requestId, true);
  } catch {
    if (requestId !== null) ipcRenderer.send('desk:flush-ack', requestId, false);
  }
});

const desk: DeskApi = {
  manageBook: (bookId, change) => call<BookView>('desk:manage-book', bookId, change),
  discoverChapters: (bookId) => call<ChapterDiscovery>('desk:discover-chapters', bookId),
  onCloseRequest: (listener) => {
    closeListeners.add(listener);
    return () => { closeListeners.delete(listener); };
  },
  appearance: () => call<AppearanceSettings>('desk:appearance'),
  setAppearance: (value) => call<void>('desk:set-appearance', value),
  layout: () => call<LayoutSettings>('desk:layout'),
  setLayout: (value) => call<void>('desk:set-layout', value),
  savePosition: (bookId, chapterId, anchor, scrollTop) =>
    call<void>('desk:save-position', bookId, chapterId, anchor, scrollTop),
  chooseBook: () => call<BookView | null>('desk:choose-book'),
  recent: () => call<Recent[]>('desk:recent'),
  openRecent: (path) => call<BookView>('desk:open-recent', path),
  forgetRecent: (path) => call<void>('desk:forget-recent', path),
  openChapter: (bookId, chapterId) => call<Snapshot>('desk:open-chapter', bookId, chapterId),
  command: (bookId, chapterId, expectedRevision, command) =>
    call<Snapshot>('desk:command', bookId, chapterId, expectedRevision, command),
  closeBook: (bookId) => call<void>('desk:close-book', bookId),
  openBookFolder: (bookId) => call<void>('desk:open-book-folder', bookId),
  openExternal: (url) => call<void>('desk:open-external', url),
  resolveExternal: (bookId, chapterId, choice) =>
    call<Snapshot>('desk:resolve-external', bookId, chapterId, choice),
  windowState: () => call<WindowState>('desk:window-state'),
  windowAction: (action) => call<WindowState>('desk:window-action', action),
  onWindowState: (listener) => {
    const handler = (_event: unknown, state: WindowState): void => listener(state);
    ipcRenderer.on('desk:window-state-changed', handler);
    return () => { ipcRenderer.removeListener('desk:window-state-changed', handler); };
  },
  reportDiagnostic: (input: DiagnosticInput) => call<void>('desk:report-diagnostic', input),
  diagnosticInfo: () => call<DiagnosticInfo>('desk:diagnostic-info'),
  openLogsFolder: () => call<void>('desk:open-logs-folder'),
  copyDiagnosticInfo: () => call<void>('desk:copy-diagnostic-info'),
  onOpenDiagnosticsRequest: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on('desk:open-diagnostics', handler);
    return () => { ipcRenderer.removeListener('desk:open-diagnostics', handler); };
  },
  onBookUpdate: (listener) => {
    const handler = (_event: unknown, update: ChapterDiscovery): void => listener(update);
    ipcRenderer.on('desk:book-update', handler);
    return () => { ipcRenderer.removeListener('desk:book-update', handler); };
  },
  onSnapshot: (listener) => {
    // Подписка удаляет ровно свой обработчик, не чужие.
    const handler = (_event: unknown, snapshot: Snapshot): void => listener(snapshot);
    ipcRenderer.on('desk:snapshot', handler);
    return () => {
      ipcRenderer.removeListener('desk:snapshot', handler);
    };
  },
};

contextBridge.exposeInMainWorld('desk', desk);
