// Scrubs any thrown value down to a diagnostics-safe shape: a known error
// `code` (allowlisted, never a raw arbitrary string) and up to 20 stack
// `frames` limited to validated app build output positions (module basename,
// line, column). The error's own `message`, any attached `arguments`, and
// every other stack frame -- including anything under the user's book
// folder -- are discarded, never merely redacted in place.
// From shared/diagnostics.ts, not main/ipc.ts: ipc.ts itself needs safeError
// (to log a cleaned exception before mapping it to a renderer-safe IpcError),
// so importing the code list from ipc.ts here would create an import cycle.
import { IPC_ERROR_CODES } from '../../shared/diagnostics';

const MAX_FRAMES = 20;

/** Node.js system error codes safe to record (short, constant identifiers). */
const NODE_ERROR_CODES = [
  'ENOSPC',
  'EACCES',
  'ENOENT',
  'EPERM',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
  'EBUSY',
  'EROFS',
  'EEXIST',
  'ENOTDIR',
  'EISDIR',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_IPC_CHANNEL_CLOSED',
  'ERR_IPC_DISCONNECTED',
] as const;

/** Exported so main/ipc.ts can revalidate a renderer-submitted `code` against
 * the exact same allowlist used when scrubbing a raw main-process exception. */
export const ALLOWED_CODES = new Set<string>([...NODE_ERROR_CODES, ...IPC_ERROR_CODES]);

/**
 * Matches a stack frame that points into validated app build output: the
 * main process bundle (`.vite/build/*.js`) or a renderer bundle asset
 * (`.../assets/*.js`). Only the file's basename, line and column survive --
 * the surrounding absolute path (which may contain the user's book folder)
 * is never captured.
 */
const APP_FRAME_PATTERN = /(?:\.vite[\\/]build[\\/]|[\\/]assets[\\/])([^\\/:()\s]+\.(?:c|m)?jsx?):(\d+):(\d+)/;

function extractFrame(line: string): string | null {
  const match = APP_FRAME_PATTERN.exec(line);
  if (match === null) return null;
  const [, file, row, column] = match;
  return `${file}:${row}:${column}`;
}

function extractFrames(error: unknown): string[] {
  const stack = error instanceof Error ? error.stack : undefined;
  if (typeof stack !== 'string') return [];
  const frames: string[] = [];
  // The first stack line is `Name: message` -- never a frame, and it's the
  // one place the raw error message would otherwise leak.
  for (const line of stack.split('\n').slice(1)) {
    const frame = extractFrame(line);
    if (frame === null) continue;
    frames.push(frame);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function extractCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !ALLOWED_CODES.has(code)) return undefined;
  return code;
}

export function safeError(error: unknown): { code?: string; frames: string[] } {
  const code = extractCode(error);
  const frames = extractFrames(error);
  return code === undefined ? { frames } : { code, frames };
}
