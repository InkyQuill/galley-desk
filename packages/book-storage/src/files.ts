import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';

/** A book path that is not a plain direct child of the book root. */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/** Lowercase SHA-256 hex of the exact bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8Text(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Chapter and sidecar paths must name a direct child of the book root,
 * mirroring the manifest `direct_child_path` pattern: no separators, no
 * traversal, nothing outside the folder the app was pointed at.
 */
export function assertDirectChildName(relativePath: string): void {
  const valid = relativePath !== '' &&
    relativePath !== '.' &&
    relativePath !== '..' &&
    !relativePath.includes('/') &&
    !relativePath.includes('\\') &&
    !relativePath.includes('\0');
  if (!valid) {
    throw new UnsafePathError(
      `Book paths must be direct children of the book root: ${JSON.stringify(relativePath)}`,
    );
  }
}

/**
 * Before writing a chapter or sidecar, refuse anything that is not an
 * ordinary direct file: symlinks (an escape hatch outside the root) and
 * directories must never be replaced through a rename.
 */
export async function assertWritableFileTarget(absPath: string): Promise<void> {
  let stat;
  try {
    stat = await lstat(absPath);
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new UnsafePathError(`Refusing to write through a symlink: ${absPath}`);
  }
  if (!stat.isFile()) {
    throw new UnsafePathError(`Write target is not an ordinary file: ${absPath}`);
  }
}

export async function readFileBytes(absPath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(absPath));
}

export async function readOptionalFileBytes(absPath: string): Promise<Uint8Array | null> {
  try {
    return await readFileBytes(absPath);
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

/** Write and fsync the file content before anyone may treat it as durable. */
export async function writeFileSynced(absPath: string, bytes: Uint8Array, flag: 'w' | 'wx' = 'w'): Promise<void> {
  const handle = await open(absPath, flag);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Temp name inside the destination's own folder (same filesystem, so the
 * rename is atomic). It must never end with `.md` or `.review.json` so a
 * crash cannot leave something that looks like a book file.
 */
export function tempNameFor(destName: string): string {
  const name = `.${destName}.galley-${randomBytes(8).toString('hex')}.tmp`;
  if (name.endsWith('.md') || name.endsWith('.review.json')) {
    throw new Error(`Temp name must not collide with book files: ${name}`);
  }
  return name;
}

/** Create and fsync a temp sibling of `destName`; returns the absolute path. */
export async function writeTempSibling(dir: string, destName: string, bytes: Uint8Array): Promise<string> {
  const tmpAbs = path.join(dir, tempNameFor(destName));
  await writeFileSynced(tmpAbs, bytes, 'wx');
  return tmpAbs;
}

/** Atomically move a temp file onto its destination, then fsync the directory. */
export async function renameFileSynced(dir: string, tmpAbs: string, destAbs: string): Promise<void> {
  try {
    await rename(tmpAbs, destAbs);
  } catch (error) {
    await unlinkIfPresent(tmpAbs);
    throw error;
  }
  await fsyncDir(dir);
}

/** Replace `destName` in `dir` with exact bytes via temp + atomic rename. */
export async function replaceFileSynced(dir: string, destName: string, bytes: Uint8Array): Promise<void> {
  const tmpAbs = await writeTempSibling(dir, destName, bytes);
  await renameFileSynced(dir, tmpAbs, path.join(dir, destName));
}

/**
 * POSIX durability: the rename only becomes durable once the directory
 * entry is synced. A failure here must propagate — it must never be
 * reported as a successful save.
 */
export async function fsyncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function unlinkIfPresent(absPath: string): Promise<void> {
  try {
    await unlink(absPath);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
}

/** Direct children that are ordinary files (symlinks and dirs excluded). */
export async function listOrdinaryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}
