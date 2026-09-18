// Bounded, rotating JSONL diagnostics writer for the main process. A single
// sequential in-memory queue serializes every append/rename against the
// filesystem; nothing here ever awaits book-save code, and a filesystem
// failure degrades the logger to `unavailable` instead of throwing. The
// writer -- never the caller -- stamps each record with its timestamp and
// the session's id, and it enriches every record with trusted, main-process
// metadata (never data received over IPC).
import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DiagnosticInput } from '../../shared/diagnostics';

export type LogMetadata = {
  appVersion: string;
  build: string;
  electron: string;
  chromium: string;
  editor: string;
  themes: string;
  platform: string;
  arch: string;
};

export type Logger = {
  write(input: DiagnosticInput): void;
  fatal(input: DiagnosticInput): void;
  flush(): Promise<void>;
  status(): 'ready' | 'unavailable';
};

/** Filesystem seam used for tests to inject ENOSPC/EACCES-style failures. */
export type LoggerFsDeps = {
  mkdir: (directory: string, options: { recursive: true }) => Promise<string | undefined>;
  stat: (target: string) => Promise<{ size: number }>;
  appendFile: (target: string, data: string, encoding: 'utf8') => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (target: string) => Promise<void>;
  mkdirSync: (directory: string, options: { recursive: true }) => void;
  statSync: (target: string) => { size: number };
  appendFileSync: (target: string, data: string, encoding: 'utf8') => void;
};

const defaultFsDeps: LoggerFsDeps = {
  mkdir: (directory, options) => fsPromises.mkdir(directory, options),
  stat: (target) => fsPromises.stat(target),
  appendFile: (target, data, encoding) => fsPromises.appendFile(target, data, { encoding }),
  rename: (from, to) => fsPromises.rename(from, to),
  unlink: (target) => fsPromises.unlink(target),
  mkdirSync: (directory, options) => fs.mkdirSync(directory, options),
  statSync: (target) => fs.statSync(target),
  appendFileSync: (target, data, encoding) => fs.appendFileSync(target, data, { encoding }),
};

/** 2 MiB per file, 3 files total (active + two rotated backups). */
const ROTATE_LIMIT_BYTES = 2 * 1024 * 1024;
/** A single serialized record never exceeds 8 KiB. */
const MAX_RECORD_BYTES = 8 * 1024;
/** Pending, not-yet-written records held in memory at once. */
const MAX_QUEUE_LENGTH = 256;

const ACTIVE_NAME = 'diagnostics.log';
const BACKUP_1_NAME = 'diagnostics.log.1';
const BACKUP_2_NAME = 'diagnostics.log.2';

/** A record accepted for serialization; the internal drop notice is not part
 * of the public DiagnosticEvent vocabulary, so this is intentionally looser
 * than DiagnosticInput (any DiagnosticInput is assignable to it). */
type WritableInput = Omit<DiagnosticInput, 'event'> & { event: string };

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return 'UNKNOWN';
}

/** Serializes a record, trimming `frames` (then dropping optional fields) so
 * the line never exceeds the 8 KiB single-write cap. */
function toLine(input: WritableInput, metadata: LogMetadata, sessionId: string): string {
  const base = { ...metadata, ...input, timestamp: new Date().toISOString(), sessionId };
  let record: typeof base = base;
  let line = JSON.stringify(record) + '\n';
  while (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES && Array.isArray(record.frames) && record.frames.length > 0) {
    record = { ...record, frames: record.frames.slice(0, -1) };
    line = JSON.stringify(record) + '\n';
  }
  if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
    // Pathological fallback (e.g. an enormous requestId): keep only the
    // fields required to identify the event.
    const minimal = {
      event: record.event,
      level: record.level,
      process: record.process,
      timestamp: record.timestamp,
      sessionId: record.sessionId,
      truncated: true,
    };
    line = JSON.stringify(minimal) + '\n';
  }
  return line;
}

export function createLogger(directory: string, metadata: LogMetadata, fsDeps: LoggerFsDeps = defaultFsDeps): Logger {
  const sessionId = randomUUID();
  const activePath = path.join(directory, ACTIVE_NAME);
  const backup1Path = path.join(directory, BACKUP_1_NAME);
  const backup2Path = path.join(directory, BACKUP_2_NAME);

  let status: 'ready' | 'unavailable' = 'ready';
  let erroredOnce = false;
  let currentSize = 0;
  let queue: string[] = [];
  let dropped = 0;
  let processing = false;
  let flushWaiters: Array<() => void> = [];

  function handleFsError(error: unknown): void {
    status = 'unavailable';
    if (!erroredOnce) {
      erroredOnce = true;
      console.error(`[desk] diagnostics: log write failed, code=${errorCode(error)}`);
    }
  }

  function resolveFlushWaiters(): void {
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const resolve of waiters) resolve();
  }

  const initPromise: Promise<void> = (async () => {
    try {
      await fsDeps.mkdir(directory, { recursive: true });
    } catch (error) {
      handleFsError(error);
      return;
    }
    try {
      currentSize = (await fsDeps.stat(activePath)).size;
    } catch {
      currentSize = 0;
    }
  })();

  async function safeUnlink(target: string): Promise<void> {
    try {
      await fsDeps.unlink(target);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }

  async function safeRename(from: string, to: string): Promise<void> {
    try {
      await fsDeps.rename(from, to);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }

  async function rotate(): Promise<void> {
    await safeUnlink(backup2Path);
    await safeRename(backup1Path, backup2Path);
    await safeRename(activePath, backup1Path);
    currentSize = 0;
  }

  async function appendLine(line: string): Promise<void> {
    const bytes = Buffer.byteLength(line, 'utf8');
    if (currentSize + bytes > ROTATE_LIMIT_BYTES) {
      await rotate();
    }
    await fsDeps.appendFile(activePath, line, 'utf8');
    currentSize += bytes;
  }

  function dropNoticeLine(count: number): string {
    return toLine(
      { event: 'diagnostics-queue-dropped', level: 'warn', process: 'main', code: String(count) },
      metadata,
      sessionId,
    );
  }

  async function processQueue(): Promise<void> {
    await initPromise;
    while (status === 'ready' && queue.length > 0) {
      const line = queue.shift()!;
      try {
        await appendLine(line);
      } catch (error) {
        handleFsError(error);
        break;
      }
      if (dropped > 0 && queue.length < MAX_QUEUE_LENGTH) {
        const count = dropped;
        dropped = 0;
        queue.unshift(dropNoticeLine(count));
      }
    }
    if (status !== 'ready') {
      // Filesystem is gone for the session: stop retaining unwritten data.
      queue = [];
      dropped = 0;
    }
    processing = false;
    if (queue.length === 0) resolveFlushWaiters();
  }

  function scheduleProcessing(): void {
    if (processing) return;
    processing = true;
    void processQueue();
  }

  function enqueue(input: WritableInput): void {
    if (status !== 'ready') return;
    if (queue.length >= MAX_QUEUE_LENGTH) {
      dropped += 1;
      return;
    }
    queue.push(toLine(input, metadata, sessionId));
    scheduleProcessing();
  }

  return {
    write(input: DiagnosticInput): void {
      enqueue(input);
    },

    fatal(input: DiagnosticInput): void {
      if (status !== 'ready') return;
      try {
        const line = toLine(input, metadata, sessionId);
        const bytes = Buffer.byteLength(line, 'utf8');
        let size: number;
        try {
          size = fsDeps.statSync(activePath).size;
        } catch {
          size = 0;
        }
        // fatal never rotates -- it only respects the existing file's
        // remaining room, skipping the write outright if there is none.
        if (size + bytes > ROTATE_LIMIT_BYTES) return;
        fsDeps.mkdirSync(directory, { recursive: true });
        fsDeps.appendFileSync(activePath, line, 'utf8');
        currentSize = size + bytes;
      } catch (error) {
        handleFsError(error);
      }
    },

    flush(): Promise<void> {
      if (queue.length === 0 && !processing) return Promise.resolve();
      return new Promise((resolve) => {
        flushWaiters.push(resolve);
      });
    },

    status(): 'ready' | 'unavailable' {
      return status;
    },
  };
}
