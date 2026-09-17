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
