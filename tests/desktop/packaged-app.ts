import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from '@playwright/test';

const LAUNCH_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 3_000;

type PackagedApp = { page: Page; stop: () => Promise<void> };

async function bounded<T>(operation: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function waitForExit(child: ChildProcess): Promise<boolean> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), STOP_TIMEOUT_MS);
    child.once('exit', onExit);
  });
}

/** Real executable + renderer CDP only; no Node inspector or fuse changes. */
export async function launchPackaged(executable: string, profile: string): Promise<PackagedApp> {
  const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], {
    env: { ...process.env, GALLEY_DESK_USER_DATA: profile }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Drain both pipes so verbose Chromium diagnostics cannot block the child.
  child.stdout!.resume();
  // Keep a listener after startup too: a process-control error must not become
  // an unhandled EventEmitter error while cleanup is already in progress.
  child.on('error', () => undefined);
  let browser: Browser | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => stopping ??= (async () => {
    try {
      if (browser) await bounded(browser.close(), STOP_TIMEOUT_MS, 'Packaged CDP disconnect timed out');
    } finally {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        if (!(await waitForExit(child))) {
          child.kill('SIGKILL');
          if (!(await waitForExit(child))) throw new Error(`Packaged process ${child.pid} did not terminate after SIGKILL`);
        }
      }
    }
  })();
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let log = '';
      const finish = (error?: Error, endpoint?: string) => {
        clearTimeout(timer);
        child.stderr!.off('data', onData);
        child.off('exit', onExit);
        child.off('error', onError);
        child.stderr!.resume();
        if (error) reject(error);
        else resolve(endpoint!);
      };
      const onData = (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-16_384);
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) finish(undefined, match[1]);
      };
      const onExit = (code: number | null, signal: string | null) => finish(new Error(`Packaged process exited (${code ?? signal}): ${log}`));
      const onError = (error: Error) => finish(new Error(`Cannot spawn packaged executable ${executable}: ${error.message}`));
      const timer = setTimeout(() => finish(new Error(`No packaged CDP endpoint within ${LAUNCH_TIMEOUT_MS}ms: ${log}`)), LAUNCH_TIMEOUT_MS);
      child.stderr!.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
    });
    browser = await chromium.connectOverCDP(endpoint, { timeout: LAUNCH_TIMEOUT_MS });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Packaged executable did not expose a browser context');
    const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: LAUNCH_TIMEOUT_MS });
    return { page, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Packaged launch and cleanup failed');
    }
    throw error;
  }
}
