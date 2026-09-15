// Local book resources: the renderer may display images that live inside the
// opened book root, addressed by the opaque book id. Traversal, symlinks out
// of the root and executable or remote URLs are rejected; remote images are
// never fetched in v1 and external http(s) links may only go through
// shell.openExternal after the scheme check below.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Custom privileged protocol serving book images (registered in main.ts). */
export const BOOK_RESOURCE_SCHEME = 'bookres';

/** v1 serves still images only; unknown extensions never reach the renderer. */
export const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export const DEFAULT_MAX_RESOURCE_BYTES = 25 * 1024 * 1024;

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * True only for http/https URLs — the only schemes allowed to reach
 * shell.openExternal (renderer wiring comes with later tasks).
 */
export function isHttpHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A markdown image target is usable only as a plain relative path inside the
 * book: any URL scheme, absolute path, traversal, percent-encoded traversal,
 * query/fragment or Windows separator is rejected here before it becomes a
 * bookres:// URL.
 */
export function isSafeRelativeImagePath(target: string): boolean {
  if (target.length === 0) return false;
  if (target.includes('\\') || target.startsWith('//') || target.startsWith('/')) return false;
  if (target.includes('?') || target.includes('#')) return false;
  if (ABSOLUTE_URL_PATTERN.test(target)) return false;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return false;
  }
  if (decoded !== target && ABSOLUTE_URL_PATTERN.test(decoded)) return false;
  const normalized = path.normalize(decoded);
  if (normalized === '.' || normalized === '..' || path.isAbsolute(normalized)) return false;
  if (normalized.split(path.sep).includes('..')) return false;
  const extension = path.extname(normalized).toLowerCase();
  return extension in IMAGE_MIME_BY_EXTENSION;
}

/** Parsed bookres://<bookId>/<encoded rel path> request. */
export type BookResourceRequest = { bookId: string; relPath: string };

/**
 * Splits a bookres URL into the opaque book id and the percent-decoded
 * relative path. Returns null for anything else; decoding errors are rejected
 * instead of partially decoded.
 */
export function parseBookResourceUrl(url: string): BookResourceRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${BOOK_RESOURCE_SCHEME}:`) return null;
  const bookId = parsed.hostname;
  if (bookId.length === 0) return null;
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  try {
    return { bookId, relPath: segments.map((segment) => decodeURIComponent(segment)).join('/') };
  } catch {
    return null;
  }
}

export type ResolvedImage = { mime: string; bytes: Uint8Array };

/**
 * Reads one image from inside the open book root. The candidate path is
 * containment-checked against the canonical root (which openBook resolved),
 * the FULL path is re-resolved via realpath — intermediate directory
 * symlinks out of the root are rejected exactly like final-component ones —
 * and only allowlisted image extensions up to the size cap are served.
 * Anything else returns null.
 */
export async function resolveBookImage(
  root: string,
  relPath: string,
  options: { maxBytes?: number } = {},
): Promise<ResolvedImage | null> {
  if (!isSafeRelativeImagePath(relPath)) return null;
  const absolute = path.resolve(root, relPath);
  const relative = path.relative(root, absolute);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  // realpath проходит по ВСЕМ компонентам пути: ссылка на каталог снаружи
  // (например `sub → /etc`) не может выдать свой файл за внутренний.
  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch {
    return null;
  }
  const resolvedRelative = path.relative(root, resolved);
  if (resolvedRelative.length === 0 || resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) {
    return null;
  }

  const fileStat = await stat(resolved).catch(() => null);
  if (fileStat === null || !fileStat.isFile()) return null;

  const extension = path.extname(resolved).toLowerCase();
  const mime = IMAGE_MIME_BY_EXTENSION[extension];
  if (mime === undefined) return null;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESOURCE_BYTES;
  if (fileStat.size > maxBytes || fileStat.size === 0) return null;

  try {
    const bytes = await readFile(resolved);
    return { mime, bytes: new Uint8Array(bytes) };
  } catch {
    return null;
  }
}
