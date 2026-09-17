import { expect, test } from 'vitest';
import { safeError } from './safe-error';

// The canonical scrubbing test from the task brief: neither the message nor
// any user path may survive, and an unrecognized frame is dropped entirely
// rather than sanitized in place.
test('strips the message and user paths; unrecognized frames are dropped', () => {
  const secret = 'PRIVATE manuscript sentence';
  const error = new Error(secret);
  error.stack = `Error: ${secret}\n    at /home/inky/Books/private.md:1:2`;
  expect(JSON.stringify(safeError(error))).not.toContain(secret);
  expect(JSON.stringify(safeError(error))).not.toContain('/home/inky');
  expect(safeError(error).frames).toEqual([]);
});

test('extracts basename, line and column from a main-process build frame', () => {
  const error = new Error('PRIVATE');
  error.stack = [
    'Error: PRIVATE',
    '    at Object.<anonymous> (/home/inky/galley-desk/apps/desktop/.vite/build/main.js:42:7)',
  ].join('\n');
  const result = safeError(error);
  expect(result.frames).toEqual(['main.js:42:7']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(JSON.stringify(result)).not.toContain('/home/inky');
});

test('extracts basename, line and column from a renderer asset frame', () => {
  const error = new Error('PRIVATE');
  error.stack = [
    'Error: PRIVATE',
    '    at r (/home/inky/galley-desk/apps/desktop/.vite/renderer/main_window/assets/index-abc123.js:10:5)',
  ].join('\n');
  const result = safeError(error);
  expect(result.frames).toEqual(['index-abc123.js:10:5']);
});

test('mixes recognized and unrecognized frames, keeping only recognized ones in order', () => {
  const error = new Error('PRIVATE');
  error.stack = [
    'Error: PRIVATE',
    '    at /home/inky/Books/private.md:1:2',
    '    at Object.<anonymous> (/app/.vite/build/main.js:10:1)',
    '    at /node_modules/some-lib/index.js:5:5',
    '    at n (/app/.vite/renderer/main_window/assets/index-xyz.js:20:2)',
  ].join('\n');
  const result = safeError(error);
  expect(result.frames).toEqual(['main.js:10:1', 'index-xyz.js:20:2']);
});

test('caps frames at 20 even when the stack has more recognized entries', () => {
  const lines = ['Error: PRIVATE'];
  for (let i = 0; i < 30; i++) {
    lines.push(`    at Object.<anonymous> (/app/.vite/build/main.js:${i}:1)`);
  }
  const error = new Error('PRIVATE');
  error.stack = lines.join('\n');
  const result = safeError(error);
  expect(result.frames).toHaveLength(20);
  expect(result.frames[0]).toBe('main.js:0:1');
  expect(result.frames[19]).toBe('main.js:19:1');
});

test('passes through an allowlisted Node fs error code', () => {
  const error = Object.assign(new Error('PRIVATE'), { code: 'ENOSPC' });
  const result = safeError(error);
  expect(result.code).toBe('ENOSPC');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test('passes through an allowlisted desk IPC error code', () => {
  const error = Object.assign(new Error('PRIVATE'), { code: 'SAVE_FAILED' });
  const result = safeError(error);
  expect(result.code).toBe('SAVE_FAILED');
});

test('drops an unrecognized code rather than passing it through', () => {
  const error = Object.assign(new Error('PRIVATE'), { code: '/home/inky/Books/private.md' });
  const result = safeError(error);
  expect(result.code).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('/home/inky');
});

test('handles non-Error thrown values without throwing', () => {
  expect(safeError('a plain string')).toEqual({ frames: [] });
  expect(safeError(null)).toEqual({ frames: [] });
  expect(safeError(undefined)).toEqual({ frames: [] });
  expect(safeError(42)).toEqual({ frames: [] });
});

test('handles an Error with no stack', () => {
  const error = new Error('PRIVATE');
  error.stack = undefined;
  expect(safeError(error)).toEqual({ frames: [] });
});

test('never includes arguments attached to the error object', () => {
  const error = Object.assign(new Error('PRIVATE'), { arguments: ['/home/inky/secret.md', 'PRIVATE'] });
  const json = JSON.stringify(safeError(error));
  expect(json).not.toContain('/home/inky');
  expect(json).not.toContain('PRIVATE');
});
