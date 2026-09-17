// Renderer-side diagnostics reporting: turns a thrown value into the closed
// DiagnosticInput shape before it ever crosses IPC. This is a courtesy pass,
// never the security boundary -- main (see main/ipc.ts's
// validateRendererDiagnostic) independently re-validates every field,
// revalidates the frame shape, forces `process` to 'renderer' and
// rate-limits per sender, because a renderer this code runs in could always
// be compromised or simply buggy.
//
// The frame-extraction pattern below intentionally mirrors
// main/diagnostics/safe-error.ts's frame pattern rather than importing it:
// that module also pulls in Electron's ipcMain (via main/ipc.ts) and cannot
// be bundled into a renderer.
import type { DiagnosticInput, RendererDiagnosticEvent } from '../../shared/diagnostics';
import { IPC_ERROR_CODES, MAX_DIAGNOSTIC_FRAMES } from '../../shared/diagnostics';

const FRAME_PATTERN = /(?:\.vite[\\/]build[\\/]|[\\/]assets[\\/])([^\\/:()\s]+\.(?:c|m)?jsx?):(\d+):(\d+)/;

function extractFrame(line: string): string | null {
  const match = FRAME_PATTERN.exec(line);
  if (match === null) return null;
  const [, file, row, column] = match;
  return `${file}:${row}:${column}`;
}

/** Only recognized bundle frames survive; the error's own message, and every
 * other stack line (which may embed the user's book path), never does. */
function extractFrames(error: unknown): string[] {
  const stack = error instanceof Error ? error.stack : undefined;
  if (typeof stack !== 'string') return [];
  const frames: string[] = [];
  for (const line of stack.split('\n').slice(1)) {
    const frame = extractFrame(line);
    if (frame === null) continue;
    frames.push(frame);
    if (frames.length >= MAX_DIAGNOSTIC_FRAMES) break;
  }
  return frames;
}

const ALLOWED_CODES = new Set<string>(IPC_ERROR_CODES);

function extractCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && ALLOWED_CODES.has(code) ? code : undefined;
}

function sanitize(event: RendererDiagnosticEvent, error: unknown): DiagnosticInput {
  const code = extractCode(error);
  const input: DiagnosticInput = { event, level: 'error', process: 'renderer', frames: extractFrames(error) };
  return code === undefined ? input : { ...input, code };
}

/**
 * Reports a caught renderer failure to the main-process diagnostics log.
 * Always resolves -- a broken or unavailable logger, a rejected IPC call, or
 * a disconnected preload bridge must never surface as a second error (that
 * would risk a reporting loop around window.onerror/unhandledrejection).
 */
export function reportError(event: RendererDiagnosticEvent, error: unknown): void {
  void window.desk.reportDiagnostic(sanitize(event, error)).catch(() => undefined);
}
