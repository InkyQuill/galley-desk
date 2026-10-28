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
import { refreshRenderer, registerDeskIpc } from './ipc';
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
 expect(validateBookChange({type:'reorder',chapterIds:['b','a']})).toEqual({type:'reorder',chapterIds:['b','a']});
 for (const payload of [{type:'reorder'}, {type:'reorder',chapterIds:[]}, {type:'reorder',chapterIds:['a', 1]}]) expect(()=>validateBookChange(payload)).toThrow();
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

test('report-diagnostic caps a true rolling 1s window, not a fixed bucket that resets at a boundary', async () => {
  // A fixed window anchored at the sender's first call would reset its count
  // to zero once `now - windowStart >= 1000`, letting a sender burst ~20
  // calls right before that boundary and another ~20 right after -- up to
  // 2x the advertised rate within a real rolling second. Prove the limiter
  // instead evicts only calls actually older than 1000ms, so calls spaced
  // across a simulated window boundary are still capped at 20 in total.
  vi.useFakeTimers();
  try {
    const h = diagnosticHarness();
    vi.setSystemTime(0);
    await h.invoke({ event: 'unhandled-renderer', level: 'error' });
    // Fill the rest of the cap just before where a fixed window would reset.
    vi.setSystemTime(990);
    for (let i = 0; i < 19; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- timestamps must advance sequentially, not concurrently
      await h.invoke({ event: 'unhandled-renderer', level: 'error' });
    }
    expect((h.logger as Logger).write).toHaveBeenCalledTimes(20);

    // Cross the 1000ms mark from the *first* call. A fixed window would treat
    // this as a fresh bucket and accept a full new burst of 20. Only the
    // t=0 call is actually stale at t=1001 (cutoff=1); the 19 calls at
    // t=990 are still within the rolling second, so only one more call
    // should fit under the cap.
    vi.setSystemTime(1001);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.invoke({ event: 'unhandled-renderer', level: 'error' })),
    );
    expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true);
    expect((h.logger as Logger).write).toHaveBeenCalledTimes(21);

    // Once the 19-call burst from t=990 has also aged past 1000ms, the
    // window is genuinely clear again and a fresh call is accepted.
    vi.setSystemTime(1991);
    await h.invoke({ event: 'unhandled-renderer', level: 'error' });
    expect((h.logger as Logger).write).toHaveBeenCalledTimes(22);
  } finally {
    vi.useRealTimers();
  }
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

test('layout IPC preserves sender validation and rejects invalid widths in main', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  const foreign = { sender, senderFrame: { parent: null, url: 'https://example.com/' } };
  const { validateLayout } = await import('./settings');
  const setLayout = vi.fn(async (value: unknown) => { validateLayout(value); });
  const layout = vi.fn(async () => ({ chaptersWidth: 315, reviewWidth: 336 }));
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn(), layout, setLayout } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(),
  });
  const getHandler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'desk:layout')![1];
  const setHandler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'desk:set-layout')![1];

  await expect(getHandler(trusted as never)).resolves.toEqual({
    ok: true, value: { chaptersWidth: 315, reviewWidth: 336 },
  });
  await expect(setHandler(trusted as never, { chaptersWidth: 400.5, reviewWidth: 360 }))
    .resolves.toMatchObject({ ok: false, code: 'SAVE_FAILED' });
  expect(setLayout).toHaveBeenCalledOnce();
  await expect(setHandler(foreign as never, { chaptersWidth: 400, reviewWidth: 360 }))
    .rejects.toThrow('IPC rejected');
  expect(setLayout).toHaveBeenCalledOnce();
});

// --- diagnostics panel: info snapshot + two safe, argument-free actions -----
//
// The renderer never supplies a path or free text here; main alone decides
// the logs directory and composes the clipboard text. These tests prove
// that guarantee holds even when a compromised renderer sends extra invoke
// arguments (e.g. a path) -- they must be silently ignored, never acted on.

import { formatDiagnosticInfo } from './ipc';
import type { DiagnosticInfo } from '../shared/api';
import type { DiagnosticsInfoDeps } from './ipc';

const DIAGNOSTIC_BASE: Omit<DiagnosticInfo, 'logging'> = {
  appVersion: '1.2.3', build: 'abc123f', platform: 'linux', arch: 'x64',
  electron: '30.0.0', editor: '0.15.0', themes: '0.15.0',
};

function diagnosticsInfoHarness(overrides: Partial<DiagnosticsInfoDeps> = {}) {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  const ensureLogsDirectory = vi.fn(async () => undefined);
  const openPath = vi.fn(async () => '');
  const writeClipboardText = vi.fn();
  const logger = { write: vi.fn(), fatal: vi.fn(), flush: vi.fn(), status: () => 'ready' as const };
  const diagnostics: DiagnosticsInfoDeps = {
    base: DIAGNOSTIC_BASE,
    logsDirectory: '/tmp/desk-logs-test',
    ensureLogsDirectory,
    openPath,
    writeClipboardText,
    ...overrides,
  };
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn() } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(), logger, diagnostics,
  });
  const handlerFor = (channel: string) => vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === channel)![1];
  return { trusted, handlerFor, ensureLogsDirectory, openPath, writeClipboardText, logger, diagnostics };
}

test('formatDiagnosticInfo composes only the six documented fields plus logging status', () => {
  const text = formatDiagnosticInfo({ ...DIAGNOSTIC_BASE, logging: 'ready' });
  expect(text).toContain('1.2.3');
  expect(text).toContain('abc123f');
  expect(text).toContain('linux');
  expect(text).toContain('x64');
  expect(text).toContain('30.0.0');
  expect(text).toContain('0.15.0');
  expect(text).toContain('ведётся');
});

test('diagnostic-info returns exactly the six documented fields plus live logging status', async () => {
  const h = diagnosticsInfoHarness();
  const result = await h.handlerFor('desk:diagnostic-info')(h.trusted as never);
  expect(result).toEqual({ ok: true, value: { ...DIAGNOSTIC_BASE, logging: 'ready' } });
  expect(Object.keys((result as { value: DiagnosticInfo }).value).sort()).toEqual(
    ['appVersion', 'arch', 'build', 'editor', 'electron', 'logging', 'platform', 'themes'].sort(),
  );
});

test('diagnostic-info reflects an unavailable logger when none is configured', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn() } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(),
    diagnostics: { base: DIAGNOSTIC_BASE, logsDirectory: '/tmp/x', ensureLogsDirectory: vi.fn(), openPath: vi.fn(), writeClipboardText: vi.fn() },
  });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'desk:diagnostic-info')![1];
  const result = await handler(trusted as never);
  expect(result).toMatchObject({ ok: true, value: { logging: 'unavailable' } });
});

test('diagnostics channels fail explicitly (not by throwing at registration) when no diagnostics deps are configured', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({ service: { subscribe: vi.fn() } as unknown as BookService, broadcast: vi.fn(), openExternal: vi.fn() });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'desk:diagnostic-info')![1];
  const result = await handler(trusted as never);
  expect(result).toMatchObject({ ok: false });
});

test('open-logs-folder creates the directory then opens exactly it, ignoring any renderer-supplied path argument', async () => {
  const h = diagnosticsInfoHarness();
  const handler = h.handlerFor('desk:open-logs-folder');
  const result = await handler(h.trusted as never, '/etc/passwd', { path: '/etc/passwd' });
  expect(result).toEqual({ ok: true, value: undefined });
  expect(h.ensureLogsDirectory).toHaveBeenCalledWith(h.diagnostics.logsDirectory);
  expect(h.openPath).toHaveBeenCalledWith(h.diagnostics.logsDirectory);
  expect(h.openPath).not.toHaveBeenCalledWith('/etc/passwd');
});

test('open-logs-folder surfaces a directory-creation failure explicitly instead of failing silently', async () => {
  const h = diagnosticsInfoHarness({ ensureLogsDirectory: vi.fn(async () => { throw new Error('EACCES'); }) });
  const result = await h.handlerFor('desk:open-logs-folder')(h.trusted as never);
  expect(result).toMatchObject({ ok: false });
  expect(h.openPath).not.toHaveBeenCalled();
});

test('open-logs-folder surfaces a shell.openPath failure instead of reporting success', async () => {
  const h = diagnosticsInfoHarness({ openPath: vi.fn(async () => 'No application found') });
  const result = await h.handlerFor('desk:open-logs-folder')(h.trusted as never);
  expect(result).toMatchObject({ ok: false });
});

test('copy-diagnostic-info writes a plain-text summary to the clipboard, never the logs path', async () => {
  const h = diagnosticsInfoHarness();
  const result = await h.handlerFor('desk:copy-diagnostic-info')(h.trusted as never, '/some/other/path');
  expect(result).toEqual({ ok: true, value: undefined });
  expect(h.writeClipboardText).toHaveBeenCalledOnce();
  const [text] = h.writeClipboardText.mock.calls[0]!;
  expect(text).not.toContain(h.diagnostics.logsDirectory);
  for (const value of Object.values(DIAGNOSTIC_BASE)) expect(text).toContain(String(value));
});

// --- desk:open-book-folder ---------------------------------------------------
//
// Открытие папки книги — ещё одно действие без пути от renderer: main сам
// берёт корень из реестра открытых книг (service.getBookRoot) по opaque id и
// вызывает инъецированный shell.openPath. Лишние аргументы вызывающей стороны
// (например, путь) игнорируются целиком; неизвестный/пустой id — BOOK_MISSING;
// непустая строка отказа shell видна вызывающему коду как IpcError.

import { openBookFolderVia } from './ipc';

function bookFolderHarness(openPath: (directory: string) => Promise<string>) {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  const foreign = { sender, senderFrame: { parent: null, url: 'https://example.com/' } };
  const getBookRoot = vi.fn((bookId: string) => (bookId === 'book-1' ? '/books/canonical' : undefined));
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn(), getBookRoot } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(), openPath,
  });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'desk:open-book-folder')![1];
  return { trusted, foreign, handler, getBookRoot, openPath };
}

test('open-book-folder resolves the root only from the service and ignores renderer-supplied paths', async () => {
  const h = bookFolderHarness(vi.fn(async () => ''));
  const result = await h.handler(h.trusted as never, 'book-1', '/etc/passwd', { path: '/etc/passwd' });
  expect(result).toEqual({ ok: true, value: undefined });
  expect(h.getBookRoot).toHaveBeenCalledTimes(1);
  expect(h.getBookRoot).toHaveBeenCalledWith('book-1');
  expect(h.openPath).toHaveBeenCalledTimes(1);
  expect(h.openPath).toHaveBeenCalledWith('/books/canonical');
  expect(h.openPath).not.toHaveBeenCalledWith('/etc/passwd');
});

test('open-book-folder rejects unknown and empty ids with BOOK_MISSING before touching the shell', async () => {
  const h = bookFolderHarness(vi.fn(async () => ''));
  for (const id of ['нет-такой-книги', '']) {
    const result = await h.handler(h.trusted as never, id);
    expect(result).toMatchObject({ ok: false, code: 'BOOK_MISSING' });
  }
  expect(h.openPath).not.toHaveBeenCalled();
});

test('open-book-folder surfaces a non-empty shell failure as a visible IpcError', async () => {
  const h = bookFolderHarness(vi.fn(async () => 'No application is associated with this directory'));
  const result = await h.handler(h.trusted as never, 'book-1');
  expect(result).toMatchObject({ ok: false, code: 'SAVE_FAILED' });
  expect(h.openPath).toHaveBeenCalledWith('/books/canonical');
});

test('openBookFolderVia rejects an untrusted sender like every desk channel', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  const foreign = { sender, senderFrame: { parent: null, url: 'https://example.com/' } };
  const openPath = vi.fn(async () => '');
  vi.mocked(ipcMain.handle).mockClear();
  registerDeskIpc({
    service: { subscribe: vi.fn(), getBookRoot: vi.fn(() => '/books/canonical') } as unknown as BookService,
    broadcast: vi.fn(), openExternal: vi.fn(), openPath,
  });
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === 'desk:open-book-folder')![1];
  await expect(handler(foreign as never, 'book-1')).rejects.toThrow('IPC rejected');
  expect(openPath).not.toHaveBeenCalled();
});


test('binder refresh acknowledgements require the trusted requesting renderer and exact token', async () => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173');
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false, isCrashed: () => false });
  const trusted = { sender, senderFrame: { parent: null, url: 'http://localhost:5173' } };
  let settled = false;
  const pending = refreshRenderer(sender as unknown as Parameters<typeof refreshRenderer>[0], { phase: 'prepare', bookId: 'book' });
  void pending.then(() => { settled = true; });
  const token = sender.send.mock.calls[0]![1];
  ipcMain.emit('desk:book-refresh-ack', { ...trusted, sender: {} }, token, true);
  ipcMain.emit('desk:book-refresh-ack', trusted, 'wrong token', true);
  ipcMain.emit('desk:book-refresh-ack', { ...trusted, senderFrame: { parent: null, url: 'https://untrusted.invalid' } }, token, true);
  await Promise.resolve();
  expect(settled).toBe(false);
  ipcMain.emit('desk:book-refresh-ack', trusted, token, true);
  await pending;
  expect(ipcMain.listenerCount('desk:book-refresh-ack')).toBe(0);
  expect(sender.listenerCount('destroyed')).toBe(0);
});

test('a crashed renderer rejects binder refresh instead of permitting retirement', async () => {
  const sender = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false, isCrashed: () => false });
  const pending = refreshRenderer(sender as unknown as Parameters<typeof refreshRenderer>[0], { phase: 'prepare', bookId: 'book' });
  sender.emit('render-process-gone');
  await expect(pending).rejects.toMatchObject({ code: 'SAVE_FAILED' });
  expect(ipcMain.listenerCount('desk:book-refresh-ack')).toBe(0);
});

test.each(['good', 'brilliant'])('accepts positive signal %s with optional comment', (signalType) => {
  const command = { type: 'signal', from: 0, to: 3, signalType, comment: '' };
  expect(validateCommand(command)).toEqual(command);
});
