// apps/desktop/src/shared/diagnostics.ts
//
// Diagnostics contract shared between main and renderer. An event carries no
// book text, comments, YAML or user paths — only the closed vocabulary below,
// plus an optional stable `code` and sanitized stack `frames` (see
// safe-error.ts). The writer (createLogger, see main/diagnostics/logger.ts)
// adds the timestamp and sessionId; callers never set them.
export type DiagnosticEvent =
  | 'session-start'
  | 'session-end'
  | 'ipc-failed'
  | 'watcher-failed'
  | 'recovery-result'
  | 'recent-update-failed'
  | 'close-failed'
  | 'uncaught-main'
  | 'unhandled-renderer'
  | 'react-render-failed'
  | 'renderer-gone'
  | 'child-gone';

export type DiagnosticInput = {
  event: DiagnosticEvent;
  level: 'info' | 'warn' | 'error';
  process: 'main' | 'renderer';
  code?: string;
  requestId?: string;
  frames?: string[];
};

/**
 * Stable IPC error codes of the desk:* contract (never renamed). Lives here
 * -- not in main/ipc.ts -- so both main/ipc.ts and main/diagnostics/safe-error.ts
 * can depend on it without an import cycle between those two files, and so
 * the renderer's report-error.ts can recognize the same codes without
 * pulling in any main-process (electron) module.
 */
export const IPC_ERROR_CODES = ['STALE_REVISION', 'SAVE_FAILED', 'EMPTY_SOURCE', 'UNAVAILABLE_RECORD', 'BOOK_MISSING'] as const;
export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

/** DiagnosticEvent values a renderer report is allowed to carry; every other
 * event in the vocabulary above is main-only and rejected at the IPC boundary. */
export const RENDERER_DIAGNOSTIC_EVENTS = ['unhandled-renderer', 'react-render-failed'] as const;
export type RendererDiagnosticEvent = (typeof RENDERER_DIAGNOSTIC_EVENTS)[number];

/** A sanitized stack frame: bare basename, line and column -- see safe-error.ts
 * for how main derives this from a raw stack. Shared so main can revalidate a
 * renderer-submitted frame against the exact same shape it would itself produce. */
const DIAGNOSTIC_FRAME_PATTERN = /^[^\\/:()\s]{1,80}\.(?:c|m)?jsx?:\d{1,7}:\d{1,7}$/;
export const MAX_DIAGNOSTIC_FRAMES = 20;
export function isDiagnosticFrame(value: unknown): value is string {
  return typeof value === 'string' && DIAGNOSTIC_FRAME_PATTERN.test(value);
}
