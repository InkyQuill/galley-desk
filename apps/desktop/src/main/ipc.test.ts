import { expect, test } from 'vitest';
import { openExternalVia, validateCommand } from './ipc';
test('rejects path-bearing arbitrary writes', () => {
  expect(() => validateCommand({type:'writeFile',path:'/tmp/x',text:'bad'})).toThrow();
  expect(() => validateCommand({type:'text',changes:[{from:-1,to:0,insert:'x'}],
    selection:{anchor:0,head:0}})).toThrow();
});

// Дополнительные короткие циклы: discriminant, поля и границы чисел.
test('accepts every documented command shape', () => {
  expect(validateCommand({ type: 'text', changes: [{ from: 0, to: 2, insert: 'кит' }], selection: { anchor: 1, head: 1 } }))
    .toEqual({ type: 'text', changes: [{ from: 0, to: 2, insert: 'кит' }], selection: { anchor: 1, head: 1 } });
  // Ключ группы ввода проходит валидацию как непустая строка.
  expect(validateCommand({ type: 'text', changes: [], selection: { anchor: 0, head: 0 }, group: 'burst-1' }))
    .toEqual({ type: 'text', changes: [], selection: { anchor: 0, head: 0 }, group: 'burst-1' });
  expect(() => validateCommand({ type: 'text', changes: [], selection: { anchor: 0, head: 0 }, group: '' })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: [], selection: { anchor: 0, head: 0 }, group: 7 })).toThrow();
  expect(validateCommand({ type: 'signal', from: 0, to: 3, signalType: 'note', comment: 'уточнить' }))
    .toEqual({ type: 'signal', from: 0, to: 3, signalType: 'note', comment: 'уточнить' });
  expect(validateCommand({ type: 'signal', id: 'abc', from: 0, to: 3, signalType: 'review', comment: '' }))
    .toEqual({ type: 'signal', id: 'abc', from: 0, to: 3, signalType: 'review', comment: '' });
  expect(validateCommand({ type: 'note', text: 'заметка главы' })).toEqual({ type: 'note', text: 'заметка главы' });
  expect(validateCommand({ type: 'remove', id: 'abc' })).toEqual({ type: 'remove', id: 'abc' });
  expect(validateCommand({ type: 'apply', id: 'abc' })).toEqual({ type: 'apply', id: 'abc' });
  expect(validateCommand({ type: 'undo-input' })).toEqual({ type: 'undo-input' });
  expect(validateCommand({ type: 'redo-input' })).toEqual({ type: 'redo-input' });
  expect(validateCommand({ type: 'undo-apply' })).toEqual({ type: 'undo-apply' });
  expect(validateCommand({ type: 'redo-apply' })).toEqual({ type: 'redo-apply' });
});

test('rejects unknown discriminants and non-object payloads', () => {
  expect(() => validateCommand({ type: 'writeFile', path: '/tmp/x', text: 'bad' })).toThrow();
  expect(() => validateCommand({ type: 'exec', code: 'x' })).toThrow();
  expect(() => validateCommand(null)).toThrow();
  expect(() => validateCommand(42)).toThrow();
  expect(() => validateCommand('text')).toThrow();
  expect(() => validateCommand(undefined)).toThrow();
});

test('rejects negative or non-integer bounds', () => {
  expect(() => validateCommand({ type: 'text', changes: [{ from: -1, to: 0, insert: 'x' }], selection: { anchor: 0, head: 0 } })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: [{ from: 0, to: 5.5, insert: 'x' }], selection: { anchor: 0, head: 0 } })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: [{ from: 3, to: 2, insert: 'x' }], selection: { anchor: 0, head: 0 } })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: [{ from: 0, to: 2, insert: 7 }], selection: { anchor: 0, head: 0 } })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: [], selection: { anchor: -3, head: 0 } })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: [], selection: { anchor: 0, head: Number.MAX_SAFE_INTEGER + 1 } })).toThrow();
  expect(() => validateCommand({ type: 'text', changes: 'all', selection: { anchor: 0, head: 0 } })).toThrow();
  expect(() => validateCommand({ type: 'signal', from: -1, to: 3, signalType: 'note', comment: '' })).toThrow();
  expect(() => validateCommand({ type: 'signal', from: 5, to: 3, signalType: 'note', comment: '' })).toThrow();
  expect(() => validateCommand({ type: 'signal', from: 0, to: 3, signalType: 'suggestion', comment: '' })).toThrow();
  expect(() => validateCommand({ type: 'signal', id: '', from: 0, to: 3, signalType: 'note', comment: '' })).toThrow();
  expect(() => validateCommand({ type: 'note' })).toThrow();
  expect(() => validateCommand({ type: 'note', text: 5 })).toThrow();
  expect(() => validateCommand({ type: 'apply' })).toThrow();
  expect(() => validateCommand({ type: 'remove', id: '' })).toThrow();
});

import { IpcError, toIpcError } from './ipc';
import type { Command } from '../shared/api';

test('maps storage errors to stable ipc codes without content', () => {
  expect(toIpcError(new IpcError('STALE_REVISION', 'стало')).code).toBe('STALE_REVISION');
  expect(toIpcError(new Error('EMPTY_SOURCE')).code).toBe('EMPTY_SOURCE');
  const unknownChapter = Object.assign(new Error('Chapter is not in the book manifest: x'), { name: 'UnknownChapterError' });
  expect(toIpcError(unknownChapter).code).toBe('BOOK_MISSING');
  const conflict = Object.assign(new Error('The chapter changed on disk'), { name: 'WriteConflictError' });
  expect(toIpcError(conflict).code).toBe('SAVE_FAILED');
  const unknown = toIpcError(new Error('whatever internal'));
  expect(unknown.code).toBe('SAVE_FAILED');
  // Сообщение неизвестной ошибки не пробрасывается в renderer.
  expect(unknown.message).not.toContain('whatever internal');
});

test('validateCommand returns the Command union for valid payloads', () => {
  const command: Command = validateCommand({ type: 'note', text: 'x' });
  expect(command.type).toBe('note');
});

// desk:open-external: валидация ссылки на границе main.
test('open-external: http(s) доходит до opener, прочие схемы отвергаются', async () => {
  const opened: string[] = [];
  const opener = async (url: string): Promise<void> => {
    opened.push(url);
  };
  await openExternalVia(opener, 'https://example.com/рукопись?a=1');
  await openExternalVia(opener, 'http://localhost:8080/x');
  expect(opened).toEqual(['https://example.com/рукопись?a=1', 'http://localhost:8080/x']);
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x', '//example.com/a', 'не ссылка', '', 42, null, undefined]) {
    const cause = await openExternalVia(opener, bad).then(
      () => null,
      (error: unknown) => error,
    );
    expect((cause as Error).name).toBe('IpcError');
    expect((cause as { code?: string }).code).toBe('SAVE_FAILED');
    // Сообщение — безопасная константа: содержимое отвергнутого значения не отражается.
    const echoed = typeof bad === 'string' ? bad : String(bad ?? '');
    if (echoed !== '') expect((cause as Error).message).not.toContain(echoed);
  }
  expect(opened).toHaveLength(2);
});

// Exercise the registered IPC handler, including its actual flush handshake.
import { vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ipcMain } from 'electron';
import { registerDeskIpc } from './ipc';
import type { BookService } from './book-service';
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { ipcMain: Object.assign(new EventEmitter(), { handle: vi.fn() }) };
});

function closeHarness(closeBook = vi.fn(async (): Promise<void> => undefined), logger?: import('./diagnostics/logger').Logger) {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const event = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  sender.send.mockImplementation((channel, id) => {
    if (channel === 'desk:flush-request' && id !== null) {
      queueMicrotask(() => ipcMain.emit('desk:flush-ack', event, id, true));
    }
  });
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({ service: { closeBook, subscribe: vi.fn() } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(), ...(logger ? { logger } : {}) });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'desk:close-book')![1];
  return { closeBook, sender, invoke: () => handler(event as never, 'book') };
}

test('a failed handler logs the cleaned exception with a generated requestId before mapping to a stable IpcError', async () => {
  const secret = 'PRIVATE manuscript sentence';
  const failure = Object.assign(new Error(secret), { code: 'ENOSPC' });
  const logger = { write: vi.fn(), fatal: vi.fn(), flush: vi.fn(), status: () => 'ready' as const };
  const h = closeHarness(vi.fn(async () => { throw failure; }), logger);
  const result = await h.invoke();
  expect(result).toMatchObject({ ok: false });
  expect(logger.write).toHaveBeenCalledOnce();
  const [record] = logger.write.mock.calls[0]!;
  expect(record).toMatchObject({ event: 'ipc-failed', level: 'error', process: 'main', code: 'ENOSPC' });
  expect(typeof record.requestId).toBe('string');
  expect(record.requestId.length).toBeGreaterThan(0);
  expect(JSON.stringify(record)).not.toContain(secret);
});

test('successful book close keeps the input barrier through response handoff', async () => {
  const h = closeHarness();
  expect(await h.invoke()).toEqual({ ok: true, value: undefined });
  expect(h.closeBook).toHaveBeenCalledOnce();
  expect(h.sender.send).not.toHaveBeenCalledWith('desk:flush-request', null);
});

test('overlapping book closes share preparation and only a failed close resumes input', async () => {
  let reject!: (cause: Error) => void;
  const closeBook = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const h = closeHarness(closeBook);
  const first = h.invoke();
  const second = h.invoke();
  await vi.waitFor(() => expect(closeBook).toHaveBeenCalledOnce());
  reject(new Error('disk unavailable'));
  expect(await first).toMatchObject({ ok: false });
  expect(await second).toMatchObject({ ok: false });
  expect(h.sender.send.mock.calls.filter(([, id]) => id === null)).toHaveLength(1);
});


import { validateBookChange } from './ipc';
test('management IPC validates operation and all supplied values', () => {
 for (const payload of [null, {}, {type:'trash'}, {type:'add',paths:[]}, {type:'add',paths:[42]}, {type:'rename',title:42}, {type:'create',title:'x',path:null}, {type:'unlink',chapterId:'x'}]) expect(()=>validateBookChange(payload)).toThrow();
 expect(validateBookChange({type:'add',paths:['a.md']})).toEqual({type:'add',paths:['a.md']});
 expect(validateBookChange({type:'trash',chapterId:'a'})).toEqual({type:'trash',chapterId:'a'});
});

// --- desk:report-diagnostic -------------------------------------------------
//
// Renderer reports are never trusted: main revalidates sender, event
// whitelist, level, code allowlist, frame shape and per-sender flood limits
// itself, regardless of what report-error.ts already sanitized client-side.
import { validateRendererDiagnostic } from './ipc';
import type { Logger } from './diagnostics/logger';

function diagnosticHarness(logger: Logger | undefined = { write: vi.fn(), fatal: vi.fn(), flush: vi.fn(), status: () => 'ready' }) {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  const foreign = { sender, senderFrame: { parent: null, url: 'https://example.com/' } };
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn() } as unknown as BookService,
    broadcast: vi.fn(),
    openExternal: vi.fn(),
    ...(logger ? { logger } : {}),
  });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'desk:report-diagnostic')![1];
  return {
    logger,
    invoke: (payload: unknown, event: typeof trusted | typeof foreign = trusted) => handler(event as never, payload),
    foreign,
    trusted,
  };
}

test('validateRendererDiagnostic accepts a well-formed renderer report and forces process to renderer', () => {
  expect(validateRendererDiagnostic({ event: 'unhandled-renderer', level: 'error', process: 'ignored-by-caller' }))
    .toEqual({ event: 'unhandled-renderer', level: 'error', process: 'renderer' });
  expect(validateRendererDiagnostic({
    event: 'react-render-failed', level: 'warn', code: 'SAVE_FAILED', frames: ['index-abc.js:10:5'],
  })).toEqual({ event: 'react-render-failed', level: 'warn', process: 'renderer', code: 'SAVE_FAILED', frames: ['index-abc.js:10:5'] });
});

test('validateRendererDiagnostic rejects main-only events, unknown fields, bad codes and unsafe frames', () => {
  expect(() => validateRendererDiagnostic({ event: 'uncaught-main', level: 'error' })).toThrow();
  expect(() => validateRendererDiagnostic({ event: 'session-start', level: 'info' })).toThrow();
  expect(() => validateRendererDiagnostic({ event: 'unhandled-renderer', level: 'error', text: 'PRIVATE manuscript sentence' })).toThrow();
  expect(() => validateRendererDiagnostic({ event: 'unhandled-renderer', level: 'shout' })).toThrow();
  expect(() => validateRendererDiagnostic({ event: 'unhandled-renderer', level: 'error', code: '/home/inky/secret.md' })).toThrow();
  expect(() => validateRendererDiagnostic({ event: 'unhandled-renderer', level: 'error', frames: 'not-an-array' })).toThrow();
  expect(() => validateRendererDiagnostic({ event: 'unhandled-renderer', level: 'error', frames: ['/home/inky/Books/private.md:1:2'] })).toThrow();
  expect(() => validateRendererDiagnostic({
    event: 'unhandled-renderer', level: 'error', frames: Array.from({ length: 21 }, (_, i) => `a.js:${i}:1`),
  })).toThrow();
  expect(() => validateRendererDiagnostic(null)).toThrow();
  expect(() => validateRendererDiagnostic('unhandled-renderer')).toThrow();
});

test('report-diagnostic rejects an untrusted sender before the handler logs anything', async () => {
  const h = diagnosticHarness();
  await expect(h.invoke({ event: 'unhandled-renderer', level: 'error' }, h.foreign)).rejects.toThrow('IPC rejected');
  expect((h.logger as Logger).write).not.toHaveBeenCalled();
});

test('report-diagnostic writes a validated renderer report to the logger', async () => {
  const h = diagnosticHarness();
  const result = await h.invoke({ event: 'unhandled-renderer', level: 'error', frames: ['index-abc.js:1:1'] });
  expect(result).toEqual({ ok: true, value: undefined });
  expect((h.logger as Logger).write).toHaveBeenCalledWith({
    event: 'unhandled-renderer', level: 'error', process: 'renderer', frames: ['index-abc.js:1:1'],
  });
});

test('report-diagnostic never lets an unknown field or payload text reach the logger', async () => {
  const secret = 'PRIVATE manuscript sentence';
  const h = diagnosticHarness();
  const result = await h.invoke({ event: 'unhandled-renderer', level: 'error', text: secret });
  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).not.toContain(secret);
  // The rejection itself is logged as an `ipc-failed` record (main's generic
  // exception logging), but that record is a cleaned exception -- a
  // code/frames tuple, never the raw payload's text -- so the secret must
  // not appear in any call the logger received.
  for (const call of vi.mocked((h.logger as Logger).write).mock.calls) {
    expect(JSON.stringify(call)).not.toContain(secret);
  }
});

test('report-diagnostic is missing when no logger is configured, without throwing', async () => {
  const h = diagnosticHarness(undefined);
  await expect(h.invoke({ event: 'unhandled-renderer', level: 'error' })).resolves.toEqual({ ok: true, value: undefined });
});

test('report-diagnostic rate-limits a flood of renderer reports server-side, independent of renderer throttling', async () => {
  const h = diagnosticHarness();
  const results = await Promise.all(Array.from({ length: 25 }, () => h.invoke({ event: 'unhandled-renderer', level: 'error' })));
  expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true);
  expect((h.logger as Logger).write).toHaveBeenCalledTimes(20);
});

test('window controls accept only explicit actions from the trusted top frame', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  const foreign = { sender, senderFrame: { parent: null, url: 'https://example.com/' } };
  const windowAction = vi.fn(() => ({ maximized: false, platform: 'linux' as const }));
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn() } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(), windowAction,
  });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'desk:window-action')![1];
  await expect(handler(trusted as never, 'destroy')).resolves.toMatchObject({ ok: false });
  expect(windowAction).not.toHaveBeenCalled();
  await expect(handler(foreign as never, 'close')).rejects.toThrow('IPC rejected');
  expect(windowAction).not.toHaveBeenCalled();
  await expect(handler(trusted as never, 'close')).resolves.toEqual({
    ok: true, value: { maximized: false, platform: 'linux' },
  });
  expect(windowAction).toHaveBeenCalledWith(sender, 'close');
});
