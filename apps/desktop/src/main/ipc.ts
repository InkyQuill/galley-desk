// Typed IPC boundary: command validation, stable error codes and sender
// validation. Main validates every invoke: senderFrame URL, registered
// book/chapter ids, expectedRevision (book-service) and command shape
// (validateCommand). Errors carry a stable `code`; main logs code and
// operation only — never manuscript content.
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { Command } from '../shared/api';

/** Stable IPC error codes of the contract (never renamed). */
export const IPC_ERROR_CODES = ['STALE_REVISION', 'SAVE_FAILED', 'EMPTY_SOURCE', 'UNAVAILABLE_RECORD', 'BOOK_MISSING'] as const;
export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

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
    return {
      type: 'text',
      changes,
      selection: { anchor: asOffset(selection.anchor, 'selection.anchor'), head: asOffset(selection.head, 'selection.head') },
    };
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
};

/**
 * Wires the explicit desk channels to the book service. The preload exposes
 * exactly these channels; there is no arbitrary-channel escape hatch. Every
 * handler validates the sender frame and answers with an envelope carrying a
 * stable error code.
 */
export function registerDeskIpc(deps: DeskIpcDeps): void {
  const { service } = deps;
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!senderIsTrusted(event)) {
        console.error(`[desk] ${channel}: отклонено — недоверенный senderFrame`);
        throw new Error('IPC rejected');
      }
      try {
        return { ok: true, value: await handler(event, args) } satisfies IpcResult<unknown>;
      } catch (error) {
        const mapped = toIpcError(error);
        // В журнал попадают только код и операция — никогда рукопись.
        console.error(`[desk] ${channel}: code=${mapped.code}`);
        return { ok: false, code: mapped.code, message: mapped.message } satisfies IpcResult<never>;
      }
    });
  };

  handle('desk:appearance', () => service.appearance());
  // Валидация значения происходит в сервисе (validateAppearance принимает
  // неизвестные данные); на границе это лишь формальная типизация.
  handle('desk:set-appearance', (_event, args) => service.setAppearance(args[0] as import('../shared/api').AppearanceSettings));
  handle('desk:save-position', (_event, args) =>
    service.savePosition(asStringArg(args[0]), asStringArg(args[1]), asNumberArg(args[2]), asNumberArg(args[3])));
  handle('desk:choose-book', () => service.chooseBook());
  handle('desk:recent', () => service.recent());
  handle('desk:open-recent', (_event, args) => service.openRecent(asStringArg(args[0])));
  handle('desk:forget-recent', (_event, args) => service.forgetRecent(asStringArg(args[0])));
  handle('desk:open-chapter', (_event, args) => service.openChapter(asStringArg(args[0]), asStringArg(args[1])));
  handle('desk:command', (_event, args) =>
    service.command(asStringArg(args[0]), asStringArg(args[1]), asNumberArg(args[2]), args[3]));
  handle('desk:close-book', (_event, args) => service.closeBook(asStringArg(args[0])));
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

// Forge Vite plugin defines these at build time (dev server URL in dev).
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
