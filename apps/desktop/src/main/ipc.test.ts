import { expect, test } from 'vitest';
import { validateCommand } from './ipc';
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
