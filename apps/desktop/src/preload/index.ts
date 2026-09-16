// Preload изолированного окна: nodeIntegration отключён, sandbox включён.
// Наружу выходят только явные методы DeskApi — никаких произвольных
// каналов и никаких ссылок на ipcRenderer в контексте страницы.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppearanceSettings,
  BookView,
  Command,
  DeskApi,
  Recent,
  Snapshot,
} from '../shared/api';

/** Ответ основного процесса: ошибки приходят конвертом со стабильным кодом. */
type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcEnvelope<T>;
  if (result.ok) return result.value;
  const error = new Error(result.message);
  (error as Error & { code: string }).code = result.code;
  throw error;
}

const desk: DeskApi = {
  appearance: () => call<AppearanceSettings>('desk:appearance'),
  setAppearance: (value) => call<void>('desk:set-appearance', value),
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
  openExternal: (url) => call<void>('desk:open-external', url),
  resolveExternal: (bookId, chapterId, choice) =>
    call<Snapshot>('desk:resolve-external', bookId, chapterId, choice),
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
