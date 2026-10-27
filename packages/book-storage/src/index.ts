/**
 * Local book persistence for Galley Desk.
 *
 * The book folder is the portable source of truth: exact UTF-8 Markdown
 * bytes plus sidecar `<chapter>.review.json` files. Journals and temporaries
 * of an interrupted save live in the appData directory, never in the book.
 *
 * Error contract:
 * - {@linkcode ManifestError} — thrown by `openBook` when `.pocket-editor.json`
 *   exists but fails `decodeManifest` (a structurally broken file or an
 *   unknown `schema_version`; v1 and v2 manifests are read, v2 tolerantly).
 *   It is a read-only identity error: the manifest is never overwritten or
 *   upgraded; carry `error.cause` to the user.
 * - {@linkcode WriteConflictError} — `writePair` re-read the pair and it no
 *   longer matches the expected revision; nothing was written.
 * - {@linkcode UnknownChapterError} / {@linkcode UnsafePathError} — the
 *   chapter is not in the manifest or the path is not a safe direct child;
 *   nothing is read through it or deleted because of it.
 *
 * Replacing the two files is not atomic; an interrupted `writePair` is
 * completed or discarded by `recoverBook` using the local journal.
 */
export type { BookHandle, Pair, Revision, WriteStep } from './book';
export {
  acceptRecoveryExternal,
  preserveRecovery,
  ManifestError,
  UnknownChapterError,
  WriteConflictError,
  openBook,
  readPair,
  recoverBook,
  writePair,
} from './book';
export { SaveQueue } from './save-queue';
export { UnsafePathError } from './files';
export { ApplyHistory } from './session-history';
export { ChapterSession, exportDraft, readDrafts } from './session';
export type { ChapterSessionState, Draft } from './session';

export { readJournalsForRoot, decodeBytes } from './journal';
export type { JournalRecord } from './journal';

export { manageBook, discoverChapters, refreshManifest, BookManagementError } from './book';
export type { BookChange } from './book';
