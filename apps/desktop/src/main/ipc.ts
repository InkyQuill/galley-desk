// Typed IPC boundary: command validation, stable error codes and sender
// validation. Main validates every invoke: senderFrame URL, registered
// book/chapter ids, expectedRevision (book-service) and command shape
// (validateCommand). Errors carry a stable `code`; main logs code and
// operation only — never manuscript content.
import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { Command, WindowAction, WindowState } from '../shared/api';
import {
  IPC_ERROR_CODES,
  isDiagnosticFrame,
  MAX_DIAGNOSTIC_FRAMES,
  RENDERER_DIAGNOSTIC_EVENTS,
  type DiagnosticEvent,
  type DiagnosticInput,
  type IpcErrorCode,
} from '../shared/diagnostics';
import { ALLOWED_CODES, safeError } from './diagnostics/safe-error';
import type { Logger } from './diagnostics/logger';
import { isHttpHttpsUrl } from './resources';

/** Stable IPC error codes of the contract (never renamed); defined in
 * shared/diagnostics.ts -- see the import above for why. */
export { IPC_ERROR_CODES };
export type { IpcErrorCode };

/** An IPC failure with a stable machine-readable code and a safe message. */
export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

/**
 * Maps any thrown error onto the stable code vocabulary. Messages of unknown
 * errors are replaced with a generic text so no unexpected content reaches
 * the renderer; known classes carry their documented safe message.
 */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof IpcError) return error;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'EMPTY_SOURCE') {
    return new IpcError('EMPTY_SOURCE', 'Правки в пустой главе недоступны: исходник не содержит текста');
  }
  if (name === 'UnknownChapterError') {
    return new IpcError('BOOK_MISSING', 'Глава отсутствует в манифесте книги');
  }
  if (name === 'UnsafePathError') {
    return new IpcError('BOOK_MISSING', 'Путь главы небезопасен, операция не выполнена');
  }
  if (name === 'WriteConflictError') {
    return new IpcError('SAVE_FAILED', 'Глава изменилась на диске; перечитайте её перед сохранением');
  }
  if (name === 'BookManagementError') return new IpcError('SAVE_FAILED', message);
  if (name === 'ManifestError') {
    // Сообщение ManifestError безопасно: путь манифеста и причина декодирования.
    return new IpcError('BOOK_MISSING', message);
  }
  if (message.startsWith('Edit is not active')) {
    return new IpcError('UNAVAILABLE_RECORD', 'Запись недоступна на текущем исходнике и не может быть применена');
  }
  return new IpcError('SAVE_FAILED', 'Операция не выполнена');
}

// --- validateCommand ---------------------------------------------------------

class CommandError extends TypeError {}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CommandError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new CommandError(`${what} must be a string`);
  return value;
}

function asNonEmptyString(value: unknown, what: string): string {
  const text = asString(value, what);
  if (text.length === 0) throw new CommandError(`${what} must not be empty`);
  return text;
}

/** Non-negative safe integer; document bounds are checked by the model. */
function asOffset(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CommandError(`${what} must be a non-negative safe integer`);
  }
  return value;
}

function asOrderedRange(record: Record<string, unknown>): { from: number; to: number } {
  const from = asOffset(record.from, 'range.from');
  const to = asOffset(record.to, 'range.to');
  if (from > to) throw new CommandError('range.from must not exceed range.to');
  return { from, to };
}

const SIGNAL_TYPES = new Set(['note', 'change_required', 'warning', 'review']);
const HISTORY_TYPES = new Set(['undo-input', 'redo-input', 'undo-apply', 'redo-apply']);

/**
 * Validates an untrusted command payload and returns the typed
 * {@linkcode Command}. Checks the discriminant, field presence/types and the
 * numeric bounds (non-negative safe integers, ordered ranges); the actual
 * document bounds are checked by the model.
 */
export function validateCommand(value: unknown): Command {
  const record = asRecord(value, 'Command');
  const type = asString(record.type, 'Command.type');
  if (type === 'text') {
    if (!Array.isArray(record.changes)) throw new CommandError('Command.changes must be an array');
    const changes = record.changes.map((change) => {
      const changeRecord = asRecord(change, 'Command.change');
      const range = asOrderedRange(changeRecord);
      return { from: range.from, to: range.to, insert: asString(changeRecord.insert, 'change.insert') };
    });
    const selection = asRecord(record.selection, 'Command.selection');
    const command: Command = {
      type: 'text',
      changes,
      selection: { anchor: asOffset(selection.anchor, 'selection.anchor'), head: asOffset(selection.head, 'selection.head') },
    };
    // Ключ группы ввода объединяет пачку набора в один undo-шаг сессии.
    if (record.group !== undefined) {
      return { ...command, group: asNonEmptyString(record.group, 'Command.group') };
    }
    return command;
  }
  if (type === 'signal') {
    const range = asOrderedRange(record);
    const signalType = asString(record.signalType, 'Command.signalType');
    if (!SIGNAL_TYPES.has(signalType)) throw new CommandError('Command.signalType is unknown');
    const comment = asString(record.comment, 'Command.comment');
    const command: Command = { type: 'signal', from: range.from, to: range.to, signalType: signalType as 'note', comment };
    if (record.id !== undefined) {
      return { ...command, id: asNonEmptyString(record.id, 'Command.id') };
    }
    return command;
  }
  if (type === 'metadata') return {type, yaml:asString(record.yaml, 'Command.yaml'),sourceText:asString(record.sourceText, 'Command.sourceText')};
  if (type === 'note') {
    return { type: 'note', text: asString(record.text, 'Command.text') };
  }
  if (type === 'remove' || type === 'apply') {
    return { type, id: asNonEmptyString(record.id, 'Command.id') };
  }
  if (HISTORY_TYPES.has(type)) {
    return { type } as Command;
  }
  throw new CommandError(`Unknown command type: ${JSON.stringify(type)}`);
}

// --- renderer diagnostic reports ---------------------------------------------
//
// The renderer's report-error.ts sanitizes before sending, but that
// sanitization is never trusted here: every field is revalidated against the
// exact same closed vocabulary/allowlist/size limits main would apply to its
// own exceptions. `process` is always forced to 'renderer' regardless of what
// was sent, and `requestId` is dropped -- it is not part of the renderer
// contract and free-form values from an untrusted sender are never retained.

const DIAGNOSTIC_FIELDS = new Set(['event', 'level', 'process', 'code', 'frames']);
const DIAGNOSTIC_LEVELS = new Set(['info', 'warn', 'error']);
const RENDERER_DIAGNOSTIC_EVENT_SET = new Set<string>(RENDERER_DIAGNOSTIC_EVENTS);

/**
 * Validates an untrusted `desk:report-diagnostic` payload into a
 * {@linkcode DiagnosticInput} safe to hand to {@linkcode Logger.write}.
 * Rejects unknown fields, main-only event types, unknown levels/codes and
 * frames outside the sanitized `file:line:column` shape -- the payload's own
 * free text (if any was smuggled onto the object) never reaches this shape.
 */
export function validateRendererDiagnostic(value: unknown): DiagnosticInput {
  const record = asRecord(value, 'DiagnosticInput');
  for (const key of Object.keys(record)) {
    if (!DIAGNOSTIC_FIELDS.has(key)) throw new CommandError(`Unknown diagnostic field: ${key}`);
  }
  const event = asString(record.event, 'DiagnosticInput.event');
  if (!RENDERER_DIAGNOSTIC_EVENT_SET.has(event)) {
    throw new CommandError('Unknown or main-only diagnostic event');
  }
  const level = asString(record.level, 'DiagnosticInput.level');
  if (!DIAGNOSTIC_LEVELS.has(level)) throw new CommandError('Unknown diagnostic level');
  const input: DiagnosticInput = { event: event as DiagnosticEvent, level: level as DiagnosticInput['level'], process: 'renderer' };
  if (record.code !== undefined) {
    const code = asString(record.code, 'DiagnosticInput.code');
    if (!ALLOWED_CODES.has(code)) throw new CommandError('Unknown diagnostic code');
    input.code = code;
  }
  if (record.frames !== undefined) {
    if (!Array.isArray(record.frames)) throw new CommandError('DiagnosticInput.frames must be an array');
    if (record.frames.length > MAX_DIAGNOSTIC_FRAMES) throw new CommandError('Too many diagnostic frames');
    input.frames = record.frames.map((frame) => {
      if (!isDiagnosticFrame(frame)) throw new CommandError('Unsafe diagnostic frame');
      return frame;
    });
  }
  return input;
}

/** Renderer events are rate-limited server-side to at most this many per
 * second per sender; the renderer's own throttling (if any) is never trusted. */
const DIAGNOSTIC_RATE_LIMIT_PER_SECOND = 20;

function createDiagnosticRateLimiter(): (sender: WebContents) => boolean {
  const windows = new WeakMap<WebContents, { windowStart: number; count: number }>();
  return (sender: WebContents): boolean => {
    const now = Date.now();
    const state = windows.get(sender);
    if (state === undefined || now - state.windowStart >= 1000) {
      windows.set(sender, { windowStart: now, count: 1 });
      return true;
    }
    if (state.count >= DIAGNOSTIC_RATE_LIMIT_PER_SECOND) return false;
    state.count += 1;
    return true;
  };
}

// --- sender validation -------------------------------------------------------

/**
 * True when the URL belongs to this app's own renderer (dev server origin or
 * the packaged renderer directory), compared by origin rather than prefix.
 * Exported so main.ts reuses the exact same rule for will-navigate.
 */
export function isOwnRendererUrl(target: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return parsed.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  }
  // Packaged mode: only files inside the built renderer are allowed.
  if (parsed.protocol !== 'file:') {
    return false;
  }
  const rendererDir = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
  let rendererPath: string;
  try {
    rendererPath = path.resolve(decodeURIComponent(parsed.pathname));
  } catch {
    return false;
  }
  const relative = path.relative(rendererDir, rendererPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Only the app's own top-level renderer frame may call the desk channels:
 * iframes and any foreign origin are rejected before the handler runs.
 */
export function senderIsTrusted(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (frame === null) return false;
  if (frame.parent !== null) return false;
  return isOwnRendererUrl(frame.url);
}

// --- channel registration ----------------------------------------------------

/** Result envelope: thrown errors lose custom fields over IPC, codes do not. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export type SnapshotBroadcaster = (snapshot: import('../shared/api').Snapshot) => void;

export type DeskIpcDeps = {
  service: import('./book-service').BookService;
  broadcast: SnapshotBroadcaster;
  /** Внешнее открытие ссылок (main передаёт shell.openExternal); инъекция — для тестов. */
  openExternal: (url: string) => Promise<void>;
  windowState?: (contents: WebContents) => WindowState;
  windowAction?: (contents: WebContents, action: WindowAction) => WindowState;
  /** Диагностический журнал; опционален (сбой создания логгера не блокирует IPC). */
  logger?: Logger;
};

/** Only a matching one-shot acknowledgement from the requested top frame counts. */
export function flushRenderer(contents: WebContents): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const finish = (ok: boolean): void => {
      clearTimeout(timeout);
      ipcMain.removeListener('desk:flush-ack', ack);
      contents.removeListener('destroyed', destroyed);
      if (ok) resolve();
      else reject(new IpcError('SAVE_FAILED', 'Не удалось сохранить изменения; окно остаётся открытым'));
    };
    const ack = (event: Electron.IpcMainEvent, requestId: unknown, ok: unknown): void => {
      if (event.sender !== contents || requestId !== id || !senderIsTrusted(event)) return;
      finish(ok === true);
    };
    const destroyed = (): void => finish(false);
    const timeout = setTimeout(() => finish(false), 30_000);
    ipcMain.on('desk:flush-ack', ack);
    contents.once('destroyed', destroyed);
    contents.send('desk:flush-request', id);
  });
}

export function resumeRenderer(contents: WebContents): void {
  if (!contents.isDestroyed()) contents.send('desk:flush-request', null);
}

/**
 * Wires the explicit desk channels to the book service. The preload exposes
 * exactly these channels; there is no arbitrary-channel escape hatch. Every
 * handler validates the sender frame and answers with an envelope carrying a
 * stable error code.
 */
export function registerDeskIpc(deps: DeskIpcDeps): void {
  const { service } = deps;
  const allowedByDiagnosticRateLimit = createDiagnosticRateLimiter();
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!senderIsTrusted(event)) {
        console.error(`[desk] ${channel}: отклонено — недоверенный senderFrame`);
        throw new Error('IPC rejected');
      }
      try {
        return { ok: true, value: await handler(event, args) } satisfies IpcResult<unknown>;
      } catch (error) {
        // Очищенный исходный exception (код + безопасные кадры, никогда
        // сообщение) уходит в журнал до перевода на стабильный IpcError —
        // ошибка деградации самого журнала никогда не блокирует ответ IPC.
        const requestId = randomUUID();
        deps.logger?.write({ event: 'ipc-failed', level: 'error', process: 'main', requestId, ...safeError(error) });
        const mapped = toIpcError(error);
        // В журнал stderr попадают только код и операция — никогда рукопись.
        console.error(`[desk] ${channel}: code=${mapped.code}`);
        return { ok: false, code: mapped.code, message: mapped.message } satisfies IpcResult<never>;
      }
    });
  };

  handle('desk:window-state', (event) => {
    if (deps.windowState === undefined) throw new IpcError('SAVE_FAILED', 'Окно недоступно');
    return deps.windowState(event.sender);
  });
  handle('desk:window-action', (event, args) => {
    if (deps.windowAction === undefined) throw new IpcError('SAVE_FAILED', 'Окно недоступно');
    const action = args[0];
    if (action !== 'minimize' && action !== 'toggle-maximize' && action !== 'close') {
      throw new IpcError('SAVE_FAILED', 'Неизвестное действие окна');
    }
    return deps.windowAction(event.sender, action);
  });
  handle('desk:appearance', () => service.appearance());
  // Валидация значения происходит в сервисе (validateAppearance принимает
  // неизвестные данные); на границе это лишь формальная типизация.
  handle('desk:set-appearance', (_event, args) => service.setAppearance(args[0] as import('../shared/api').AppearanceSettings));
  handle('desk:save-position', (_event, args) =>
    service.savePosition(asStringArg(args[0]), asStringArg(args[1]), asNumberArg(args[2]), asNumberArg(args[3])));
  handle('desk:discover-chapters', (_event, args) => service.discoverChapters(asStringArg(args[0])));
  handle('desk:manage-book', async (event, args) => {
    const bookId = asStringArg(args[0]);
    const change = validateBookChange(args[1]);
    try {
      await flushRenderer(event.sender);
      return await service.manageBook(bookId, change);
    } finally { resumeRenderer(event.sender); }
  });
  handle('desk:choose-book', () => service.chooseBook());
  handle('desk:recent', () => service.recent());
  handle('desk:open-recent', (_event, args) => service.openRecent(asStringArg(args[0])));
  handle('desk:forget-recent', (_event, args) => service.forgetRecent(asStringArg(args[0])));
  handle('desk:open-chapter', (_event, args) => service.openChapter(asStringArg(args[0]), asStringArg(args[1])));
  handle('desk:command', (_event, args) =>
    service.command(asStringArg(args[0]), asStringArg(args[1]), asNumberArg(args[2]), args[3]));
  const bookCloses = new WeakMap<WebContents, { bookId: string; pending: Promise<void> }>();
  handle('desk:close-book', (event, args) => {
    const bookId = asStringArg(args[0]);
    const existing = bookCloses.get(event.sender);
    if (existing !== undefined) {
      if (existing.bookId !== bookId) throw new IpcError('SAVE_FAILED', 'Закрытие книги уже выполняется');
      return existing.pending;
    }
    const pending = (async () => {
      try {
        await flushRenderer(event.sender);
        await service.closeBook(bookId);
        // Keep input inert until the successful invoke response unmounts the book.
      } catch (error) {
        resumeRenderer(event.sender);
        throw error;
      } finally {
        bookCloses.delete(event.sender);
      }
    })();
    bookCloses.set(event.sender, { bookId, pending });
    return pending;
  });
  handle('desk:open-external', (_event, args) => openExternalVia(deps.openExternal, args[0]));
  // Successful per-keystroke typing is never logged: only a report the
  // renderer explicitly sends (unhandled error/rejection, boundary catch)
  // reaches this channel, and a flood of such reports beyond the rate limit
  // is silently dropped -- the caller still receives an ok response
  // (report-error.ts already treats failures as `.catch(() => undefined)`).
  handle('desk:report-diagnostic', (event, args) => {
    if (!allowedByDiagnosticRateLimit(event.sender)) return undefined;
    if (deps.logger === undefined) return undefined;
    deps.logger.write(validateRendererDiagnostic(args[0]));
    return undefined;
  });
  handle('desk:resolve-external', (_event, args) => {
    const choice = args[2];
    if (choice !== 'open-external' && choice !== 'export-local') {
      throw new IpcError('SAVE_FAILED', 'Неизвестный вариант разрешения внешнего изменения');
    }
    return service.resolveExternal(asStringArg(args[0]), asStringArg(args[1]), choice);
  });

  service.subscribe(deps.broadcast);
}

function asStringArg(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new IpcError('BOOK_MISSING', 'Некорректный идентификатор');
  return value;
}

function asNumberArg(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new IpcError('SAVE_FAILED', 'Некорректное числовое значение');
  }
  return value;
}

/** Безопасная константа отказа внешней ссылки: содержимое URL не отражается. */
export const EXTERNAL_LINK_REJECTED_MESSAGE = 'Открытие ссылки отклонено: поддерживаются только http(s)-адреса';

/**
 * Валидирует недоверенный URL для desk:open-external и передаёт его
 * инъецированному opener (в main — shell.openExternal). Проходят только
 * http(s); всё остальное отвергается со стабильным кодом и константным
 * сообщением без эха содержимого.
 */
export async function openExternalVia(
  openExternal: (url: string) => Promise<void>,
  url: unknown,
): Promise<void> {
  if (typeof url !== 'string' || !isHttpHttpsUrl(url)) {
    throw new IpcError('SAVE_FAILED', EXTERNAL_LINK_REJECTED_MESSAGE);
  }
  await openExternal(url);
}

// Forge Vite plugin defines these at build time (dev server URL in dev).
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export function validateBookChange(value: unknown): import('../shared/api').BookChange {
  const record = asRecord(value, 'BookChange');
  switch (record.type) {
    case 'rename': return { type: 'rename', title: asNonEmptyString(record.title, 'title') };
    case 'create': return { type: 'create', path: asNonEmptyString(record.path, 'path'), title: asNonEmptyString(record.title, 'title') };
    case 'add':
      if (!Array.isArray(record.paths) || !record.paths.length) throw new CommandError('paths must be nonempty');
      return { type: 'add', paths: record.paths.map(p => asNonEmptyString(p, 'path')) };
    case 'remove': case 'trash': return { type: record.type, chapterId: asNonEmptyString(record.chapterId, 'chapterId') };
    default: throw new CommandError('Unknown book change');
  }
}
