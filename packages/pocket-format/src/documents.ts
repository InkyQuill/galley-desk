import { readFileSync } from 'node:fs';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

/**
 * Wire types of the Pocket Editor sidecar format. Field names follow the JSON
 * wire names exactly; offsets are UTF-8 byte positions.
 */
export type Anchor = {
  source_sha256: string;
  selection_sha256: string;
  start_byte: number;
  end_byte: number;
  start_line: number;
  end_line: number;
  prefix: string;
  suffix: string;
};

export type Edit = { id: string; before: string; after: string; anchor: Anchor };

export type SignalType = 'note' | 'change_required' | 'warning' | 'review';

export type Signal = {
  id: string;
  type: SignalType;
  selected_text: string;
  anchor: Anchor;
  comment: string;
};

export type Review = {
  schema_version: 1;
  chapter_id: string;
  source_path: string;
  chapter_note: string;
  edits: Edit[];
  signals: Signal[];
};

export type Chapter = { id: string; path: string; title: string };

export type Manifest = {
  schema_version: 1;
  book_id: string;
  title: string;
  chapters: Chapter[];
  ignored_files: string[];
};

/** Half-open byte range into the exact source bytes. */
export type Range = { from: number; to: number };

export type Resolution =
  | { kind: 'resolved'; range: Range }
  | { kind: 'stale' }
  | { kind: 'ambiguous'; candidates: Range[] };

export type Availability = {
  edits: Map<string, Range>;
  signals: Map<string, Range>;
  unavailable: Map<string, Resolution>;
  conflicting: Set<string>;
};

const MAX_CONTEXT_CODE_POINTS = 128;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type ReviewSchemaShape = {
  $defs: {
    anchor: {
      properties: {
        prefix: { maxLength?: number };
        suffix: { maxLength?: number };
      };
    };
  };
};

/**
 * The published schema constrains anchor prefix/suffix with JSON Schema
 * `maxLength`, which counts UTF-16 code units, while Pocket Editor itself
 * counts Unicode code points (ReviewJson.validate). A context of 128 astral
 * code points (for example emoji) is valid per Kotlin but larger in UTF-16
 * units, so `maxLength` is dropped from the compiled copy and the code point
 * limit is enforced relationally instead.
 */
function compileReviewSchema(): ValidateFunction {
  const schema = JSON.parse(
    readFileSync(new URL('../schemas/review-v1.schema.json', import.meta.url), 'utf8'),
  ) as ReviewSchemaShape;
  const copy = structuredClone(schema);
  const anchor = copy.$defs.anchor.properties;
  delete anchor.prefix.maxLength;
  delete anchor.suffix.maxLength;
  const ajv = new Ajv2020();
  return ajv.compile(copy);
}

function compileManifestSchema(): ValidateFunction {
  const schema = JSON.parse(
    readFileSync(new URL('../schemas/manifest-v1.schema.json', import.meta.url), 'utf8'),
  );
  const ajv = new Ajv2020();
  return ajv.compile(schema);
}

const validateReviewSchema = compileReviewSchema();
const validateManifestSchema = compileManifestSchema();

type ReviewWire = {
  schema_version?: number;
  chapter_id: string;
  source_path: string;
  chapter_note?: string;
  edits?: Edit[];
  signals?: Signal[];
};

type ManifestWire = {
  schema_version?: number;
  book_id: string;
  title: string;
  chapters?: Chapter[];
  ignored_files?: string[];
};

function parseJson(json: string, what: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${(error as Error).message}`);
  }
}

function schemaErrors(what: string, validate: ValidateFunction): Error {
  return new Error(`${what} does not match the v1 schema: ${ajvErrorsText(validate.errors)}`);
}

function ajvErrorsText(errors: ValidateFunction['errors']): string {
  if (!errors) return 'unknown validation error';
  return errors.map((error) => `${error.instancePath} ${error.message ?? ''}`).join('; ');
}

export function decodeReview(json: string, chapterId: string, path: string): Review {
  const parsed = parseJson(json, 'Review sidecar') as ReviewWire;
  if (!validateReviewSchema(parsed)) throw schemaErrors('Review sidecar', validateReviewSchema);
  const review: Review = {
    schema_version: (parsed.schema_version ?? 1) as 1,
    chapter_id: parsed.chapter_id,
    source_path: parsed.source_path,
    chapter_note: parsed.chapter_note ?? '',
    edits: parsed.edits ?? [],
    signals: parsed.signals ?? [],
  };
  validateReview(review, { requireSafeOffsets: false });
  if (review.chapter_id !== chapterId) {
    throw new Error('Review chapter_id does not match its manifest entry');
  }
  if (review.source_path !== path) {
    throw new Error('Review source_path does not match its source chapter');
  }
  return review;
}

export function encodeReview(review: Review): string {
  // Kotlin encodes with validate() first, so relational messages win over
  // schema messages; the schema check remains as a structural backstop.
  validateReview(review, { requireSafeOffsets: true });
  if (!validateReviewSchema(review)) throw schemaErrors('Review', validateReviewSchema);
  return serializeReview(review);
}

export function decodeManifest(json: string): Manifest {
  const parsed = parseJson(json, 'Manifest') as ManifestWire;
  if (!validateManifestSchema(parsed)) throw schemaErrors('Manifest', validateManifestSchema);
  if (parsed.schema_version === undefined) {
    throw new Error('Unsupported manifest schema version');
  }
  const manifest: Manifest = {
    schema_version: 1,
    book_id: parsed.book_id,
    title: parsed.title,
    chapters: parsed.chapters ?? [],
    ignored_files: parsed.ignored_files ?? [],
  };
  validateManifest(manifest);
  return manifest;
}

export function encodeManifest(manifest: Manifest): string {
  validateManifest(manifest);
  if (!validateManifestSchema(manifest)) throw schemaErrors('Manifest', validateManifestSchema);
  return serializeManifest(manifest);
}

/**
 * Relational checks mirroring ReviewJson.validate, except for the deliberate
 * Galley Desk divergence: intersecting saved ranges do not invalidate a
 * sidecar; classifyReview() excludes all intersection participants instead.
 */
function validateReview(review: Review, options: { requireSafeOffsets: boolean }): void {
  if (review.schema_version !== 1) {
    throw new Error(`Unsupported review schema version: ${String(review.schema_version)}`);
  }
  const recordIds = [...review.signals.map((signal) => signal.id), ...review.edits.map((edit) => edit.id)];
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error('Record IDs must be unique');
  }
  for (const signal of review.signals) {
    validateAnchor(signal.anchor, options.requireSafeOffsets);
  }
  for (const edit of review.edits) {
    if (edit.before.length === 0) throw new Error('Edit before text must not be empty');
    if (edit.after === edit.before) throw new Error('Edit after text must differ from before text');
    validateAnchor(edit.anchor, options.requireSafeOffsets);
  }
}

function validateAnchor(anchor: Anchor, requireSafeOffsets: boolean): void {
  if (!SHA256_PATTERN.test(anchor.source_sha256)) {
    throw new Error('source_sha256 must be lowercase SHA-256 hex');
  }
  if (!SHA256_PATTERN.test(anchor.selection_sha256)) {
    throw new Error('selection_sha256 must be lowercase SHA-256 hex');
  }
  if (
    !Number.isInteger(anchor.start_byte) ||
    !Number.isInteger(anchor.end_byte) ||
    anchor.start_byte < 0 ||
    anchor.end_byte <= anchor.start_byte
  ) {
    throw new Error('Anchor byte range must be non-empty, non-negative, and half-open');
  }
  if (requireSafeOffsets && (!Number.isSafeInteger(anchor.start_byte) || !Number.isSafeInteger(anchor.end_byte))) {
    throw new Error('Anchor byte offsets must be safe integers to encode a sidecar');
  }
  if (!(anchor.start_line >= 1 && anchor.end_line >= anchor.start_line)) {
    throw new Error('Anchor line hints must be one-based and ordered');
  }
  if (codePointCount(anchor.prefix) > MAX_CONTEXT_CODE_POINTS) {
    throw new Error(`Anchor prefix must not exceed ${MAX_CONTEXT_CODE_POINTS} Unicode code points`);
  }
  if (codePointCount(anchor.suffix) > MAX_CONTEXT_CODE_POINTS) {
    throw new Error(`Anchor suffix must not exceed ${MAX_CONTEXT_CODE_POINTS} Unicode code points`);
  }
}

function validateManifest(manifest: Manifest): void {
  const chapterIds = manifest.chapters.map((chapter) => chapter.id);
  if (new Set(chapterIds).size !== chapterIds.length) throw new Error('Chapter IDs must be unique');
  const chapterPaths = manifest.chapters.map((chapter) => chapter.path);
  if (new Set(chapterPaths).size !== chapterPaths.length) throw new Error('Chapter paths must be unique');
  const ignored = new Set(manifest.ignored_files);
  for (const path of chapterPaths) {
    if (ignored.has(path)) throw new Error('A chapter path cannot also be ignored');
  }
}

function codePointCount(value: string): number {
  return [...value].length;
}

/**
 * Canonical JSON writer matching kotlinx.serialization pretty print with a
 * two-space indent: fixed field order, records sorted by id, one trailing LF.
 * Escaping mirrors the kotlinx escape table (lowercase \u00xx for the
 * remaining C0 controls, short escapes for \b \t \n \f \r, raw non-ASCII).
 */
function quoteJson(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    switch (unit) {
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      default:
        if (unit < 0x20) out += `\\u${unit.toString(16).padStart(4, '0')}`;
        else out += value[i];
    }
  }
  return `${out}"`;
}

const INDENT = '  ';

function emitObject(indent: string, entries: ReadonlyArray<readonly [string, string]>): string {
  const inner = indent + INDENT;
  const lines = entries.map(([key, value], index) => {
    const comma = index < entries.length - 1 ? ',' : '';
    return `${inner}${quoteJson(key)}: ${value}${comma}`;
  });
  return ['{', ...lines, `${indent}}`].join('\n');
}

/**
 * `fieldIndent` is the column of the array's closing bracket (the field line
 * level); items sit one level deeper, and each item's own content one more,
 * matching kotlinx pretty print:
 *
 *   "signals": [
 *     {
 *       "id": ...
 *     }
 *   ]
 */
function emitArray<T>(items: readonly T[], emitItem: (item: T, itemIndent: string) => string, fieldIndent: string): string {
  if (items.length === 0) return '[]';
  const itemIndent = fieldIndent + INDENT;
  const lines = items.map((item) => `${itemIndent}${emitItem(item, itemIndent)}`).join(',\n');
  return ['[', lines, `${fieldIndent}]`].join('\n');
}

function emitAnchor(anchor: Anchor, indent: string): string {
  return emitObject(indent, [
    ['source_sha256', quoteJson(anchor.source_sha256)],
    ['selection_sha256', quoteJson(anchor.selection_sha256)],
    ['start_byte', String(anchor.start_byte)],
    ['end_byte', String(anchor.end_byte)],
    ['start_line', String(anchor.start_line)],
    ['end_line', String(anchor.end_line)],
    ['prefix', quoteJson(anchor.prefix)],
    ['suffix', quoteJson(anchor.suffix)],
  ]);
}

function emitSignal(signal: Signal, indent: string): string {
  return emitObject(indent, [
    ['id', quoteJson(signal.id)],
    ['type', quoteJson(signal.type)],
    ['selected_text', quoteJson(signal.selected_text)],
    ['anchor', emitAnchor(signal.anchor, indent + INDENT)],
    ['comment', quoteJson(signal.comment)],
  ]);
}

function emitEdit(edit: Edit, indent: string): string {
  return emitObject(indent, [
    ['id', quoteJson(edit.id)],
    ['before', quoteJson(edit.before)],
    ['after', quoteJson(edit.after)],
    ['anchor', emitAnchor(edit.anchor, indent + INDENT)],
  ]);
}

/** Kotlin `sortedBy(id)`: stable, by UTF-16 code units. */
function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function serializeReview(review: Review): string {
  const body = emitObject('', [
    ['schema_version', '1'],
    ['chapter_id', quoteJson(review.chapter_id)],
    ['source_path', quoteJson(review.source_path)],
    ['chapter_note', quoteJson(review.chapter_note)],
    ['signals', emitArray([...review.signals].sort(byId), emitSignal, INDENT)],
    ['edits', emitArray([...review.edits].sort(byId), emitEdit, INDENT)],
  ]);
  return `${body}\n`;
}

function serializeManifest(manifest: Manifest): string {
  const body = emitObject('', [
    ['schema_version', '1'],
    ['book_id', quoteJson(manifest.book_id)],
    ['title', quoteJson(manifest.title)],
    [
      'chapters',
      emitArray(
        manifest.chapters,
        (chapter, indent) =>
          emitObject(indent, [
            ['id', quoteJson(chapter.id)],
            ['path', quoteJson(chapter.path)],
            ['title', quoteJson(chapter.title)],
          ]),
        INDENT,
      ),
    ],
    ['ignored_files', emitArray([...manifest.ignored_files].sort(), (path) => quoteJson(path), INDENT)],
  ]);
  return `${body}\n`;
}
