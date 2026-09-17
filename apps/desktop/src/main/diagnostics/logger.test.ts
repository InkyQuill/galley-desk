import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createLogger, type LogMetadata, type LoggerFsDeps } from './logger';
import type { DiagnosticInput } from '../../shared/diagnostics';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'galley-diagnostics-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

const metadata: LogMetadata = {
  appVersion: '0.1.0',
  build: 'test',
  electron: '33.0.0',
  chromium: '130.0.0',
  editor: '0.15.0',
  themes: '0.15.0',
  platform: 'linux',
  arch: 'x64',
};

function event(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return { event: 'session-start', level: 'info', process: 'main', ...overrides };
}

async function activeLines(dir: string): Promise<string[]> {
  const raw = await readFile(path.join(dir, 'diagnostics.log'), 'utf8');
  return raw.split('\n').filter((line) => line.length > 0);
}

// --- JSONL shape, ordering, writer-owned fields -----------------------------

test('writes newline-delimited JSON with writer-owned timestamp and sessionId', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  logger.write(event({ event: 'session-start' }));
  await logger.flush();
  const lines = await activeLines(dir);
  expect(lines).toHaveLength(1);
  const record = JSON.parse(lines[0]!);
  expect(record.event).toBe('session-start');
  expect(record.level).toBe('info');
  expect(record.process).toBe('main');
  expect(typeof record.timestamp).toBe('string');
  expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
  expect(typeof record.sessionId).toBe('string');
  expect(record.sessionId.length).toBeGreaterThan(0);
  expect(record.appVersion).toBe('0.1.0');
  expect(record.editor).toBe('0.15.0');
});

test('preserves the order of 100 events', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  for (let i = 0; i < 100; i++) {
    logger.write(event({ event: 'ipc-failed', requestId: String(i) }));
  }
  await logger.flush();
  const lines = await activeLines(dir);
  expect(lines).toHaveLength(100);
  const ids = lines.map((line) => JSON.parse(line).requestId);
  expect(ids).toEqual(Array.from({ length: 100 }, (_, i) => String(i)));
});

test('two loggers writing concurrently each get a distinct sessionId', async () => {
  const dirA = await tempDir();
  const dirB = await tempDir();
  const a = createLogger(dirA, metadata);
  const b = createLogger(dirB, metadata);
  a.write(event());
  b.write(event());
  await Promise.all([a.flush(), b.flush()]);
  const recordA = JSON.parse((await activeLines(dirA))[0]!);
  const recordB = JSON.parse((await activeLines(dirB))[0]!);
  expect(recordA.sessionId).not.toBe(recordB.sessionId);
});

// --- rotation ----------------------------------------------------------------

const ROTATE_LIMIT = 2 * 1024 * 1024;

/**
 * Writes `total` padded events in batches smaller than the 256-entry queue
 * cap, flushing between batches so the writer actually drains to disk
 * (rather than dropping the excess as a queue overflow).
 */
async function writePadded(logger: ReturnType<typeof createLogger>, total: number, padSize: number): Promise<void> {
  const pad = 'x'.repeat(padSize);
  const batchSize = 50;
  for (let written = 0; written < total; written += batchSize) {
    const count = Math.min(batchSize, total - written);
    for (let i = 0; i < count; i++) logger.write(event({ requestId: pad }));
    await logger.flush();
  }
}

test('rotates the active file at the 2 MiB boundary, keeping at most 3 files', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  // ~4 KiB per line; 800 lines is well past one 2 MiB rotation boundary.
  await writePadded(logger, 800, 4000);
  const files = await readdir(dir);
  const logFiles = files.filter((name) => name.startsWith('diagnostics.log'));
  expect(logFiles.length).toBeLessThanOrEqual(3);
  expect(logFiles).toContain('diagnostics.log');
  expect(logFiles).toContain('diagnostics.log.1');
  const activeSize = (await stat(path.join(dir, 'diagnostics.log'))).size;
  expect(activeSize).toBeLessThanOrEqual(ROTATE_LIMIT);
  const backupSize = (await stat(path.join(dir, 'diagnostics.log.1'))).size;
  expect(backupSize).toBeLessThanOrEqual(ROTATE_LIMIT);
}, 20000);

test('never keeps more than 2 backup files after many rotations', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  // Enough volume to rotate at least twice, forcing the oldest file to drop.
  await writePadded(logger, 2200, 4000);
  const files = await readdir(dir);
  const logFiles = files.filter((name) => name.startsWith('diagnostics.log'));
  expect(logFiles.sort()).toEqual(['diagnostics.log', 'diagnostics.log.1', 'diagnostics.log.2']);
}, 20000);

// --- large events + queue overflow -------------------------------------------

test('truncates an oversized event to stay within the 8 KiB single-write limit', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  const hugeFrames = Array.from({ length: 500 }, (_, i) => `module-${i}.js:${i}:${i}`);
  logger.write(event({ event: 'uncaught-main', frames: hugeFrames }));
  await logger.flush();
  const lines = await activeLines(dir);
  expect(lines).toHaveLength(1);
  expect(Buffer.byteLength(lines[0]! + '\n', 'utf8')).toBeLessThanOrEqual(8192);
  const record = JSON.parse(lines[0]!);
  expect(record.event).toBe('uncaught-main');
  expect(typeof record.timestamp).toBe('string');
});

test('drops entries beyond the 256-entry queue cap and records one drop notice', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  // Write far more than the queue can hold before anything has a chance to
  // drain, so the excess is dropped rather than queued.
  for (let i = 0; i < 400; i++) {
    logger.write(event({ event: 'ipc-failed', requestId: String(i) }));
  }
  await logger.flush();
  const lines = await activeLines(dir);
  const records = lines.map((line) => JSON.parse(line));
  const notices = records.filter((record) => record.event === 'diagnostics-queue-dropped');
  expect(notices.length).toBeGreaterThanOrEqual(1);
  const totalDropped = notices.reduce((sum, notice) => sum + Number(notice.code), 0);
  const kept = records.filter((record) => record.event === 'ipc-failed').length;
  expect(kept + totalDropped).toBe(400);
  expect(kept).toBeLessThanOrEqual(256);
});

// --- fs error injection --------------------------------------------------

function fakeFsDeps(overrides: Partial<LoggerFsDeps>): LoggerFsDeps {
  return {
    mkdir: async () => undefined,
    stat: async () => {
      const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw error;
    },
    appendFile: async () => undefined,
    rename: async () => undefined,
    unlink: async () => {
      const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw error;
    },
    mkdirSync: () => undefined,
    statSync: () => {
      const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      throw error;
    },
    appendFileSync: () => undefined,
    ...overrides,
  };
}

test('an ENOSPC on append marks the logger unavailable and logs to stderr once', async () => {
  const dir = await tempDir();
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps = fakeFsDeps({
    appendFile: async () => {
      const error = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      throw error;
    },
  });
  const logger = createLogger(dir, metadata, deps);
  logger.write(event());
  logger.write(event());
  await logger.flush();
  expect(logger.status()).toBe('unavailable');
  expect(stderr).toHaveBeenCalledTimes(1);
});

test('an EACCES on mkdir marks the logger unavailable without throwing', async () => {
  const dir = await tempDir();
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps = fakeFsDeps({
    mkdir: async () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw error;
    },
  });
  const logger = createLogger(dir, metadata, deps);
  expect(() => logger.write(event())).not.toThrow();
  await logger.flush();
  expect(logger.status()).toBe('unavailable');
  expect(stderr).toHaveBeenCalledTimes(1);
});

test('flush resolves after an fs error instead of hanging', async () => {
  const dir = await tempDir();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps = fakeFsDeps({
    appendFile: async () => {
      const error = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      throw error;
    },
  });
  const logger = createLogger(dir, metadata, deps);
  for (let i = 0; i < 5; i++) logger.write(event());
  await expect(logger.flush()).resolves.toBeUndefined();
  // Further writes after the logger is unavailable must never throw.
  expect(() => logger.write(event())).not.toThrow();
  await expect(logger.flush()).resolves.toBeUndefined();
});

// --- fatal() ------------------------------------------------------------

test('fatal writes synchronously, bypassing the queue', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  logger.fatal(event({ event: 'uncaught-main', level: 'error' }));
  // No await/flush: fatal must already be on disk synchronously.
  const lines = await activeLines(dir);
  expect(lines).toHaveLength(1);
  const record = JSON.parse(lines[0]!);
  expect(record.event).toBe('uncaught-main');
  expect(typeof record.sessionId).toBe('string');
});

test('fatal never throws even when the filesystem is unavailable', () => {
  const deps = fakeFsDeps({
    mkdirSync: () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw error;
    },
    appendFileSync: () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw error;
    },
  });
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const logger = createLogger('/nonexistent/path/for/test', metadata, deps);
  expect(() => logger.fatal(event({ event: 'uncaught-main' }))).not.toThrow();
  expect(logger.status()).toBe('unavailable');
  expect(stderr).toHaveBeenCalledTimes(1);
});

test('fatal respects the file size limit without rotating', () => {
  const deps = fakeFsDeps({
    statSync: () => ({ size: ROTATE_LIMIT }),
    appendFileSync: vi.fn(),
  });
  const logger = createLogger('/tmp/does-not-matter', metadata, deps);
  logger.fatal(event({ event: 'uncaught-main' }));
  expect(deps.appendFileSync).not.toHaveBeenCalled();
});

// --- status ---------------------------------------------------------------

test('status starts ready', async () => {
  const dir = await tempDir();
  const logger = createLogger(dir, metadata);
  expect(logger.status()).toBe('ready');
  await logger.flush();
  expect(logger.status()).toBe('ready');
});
