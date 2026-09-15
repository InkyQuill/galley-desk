import { createHash } from 'node:crypto';
import type { Anchor, Range, Resolution } from './documents';

const textEncoder = new TextEncoder();
const MAX_CONTEXT_CODE_POINTS = 128;
const NEWLINE_BYTE = 0x0a;

/**
 * Creates an anchor from exact source bytes, mirroring AnchorFactory.create:
 * strict UTF-8 decoding of the whole source and of each range slice, code
 * point aligned boundaries, 128 code point context windows, SHA-256 hashes
 * and one-based line hints counted from raw newline bytes (CRLF included).
 */
export function makeAnchor(source: Uint8Array, range: Range): Anchor {
  const { from, to } = range;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > source.length
  ) {
    throw new Error('Anchor byte range must be non-empty, non-negative, and within the source');
  }
  // The whole source must be valid UTF-8, exactly like AnchorFactory.
  decodeUtf8Strict(source.subarray());
  let prefixText: string;
  let suffixText: string;
  try {
    prefixText = decodeUtf8Strict(source.subarray(0, from));
    decodeUtf8Strict(source.subarray(from, to));
    suffixText = decodeUtf8Strict(source.subarray(to));
  } catch {
    throw new Error('Anchor byte offsets must align to UTF-8 code-point boundaries');
  }
  return {
    source_sha256: sha256(source),
    selection_sha256: sha256(source.subarray(from, to)),
    start_byte: from,
    end_byte: to,
    start_line: lineAtByteOffset(source, from),
    end_line: lineAtByteOffset(source, to - 1),
    prefix: takeLastCodePoints(prefixText, MAX_CONTEXT_CODE_POINTS),
    suffix: takeFirstCodePoints(suffixText, MAX_CONTEXT_CODE_POINTS),
  };
}

/**
 * Resolves an anchor against (possibly changed) source bytes, mirroring
 * AnchorResolver.resolve: stale on empty or hash-mismatched selection; the
 * saved range when the source hash still matches; otherwise the single exact
 * occurrence, or prefix/suffix disambiguation among several occurrences.
 */
export function resolveAnchor(source: Uint8Array, anchor: Anchor, selected: string): Resolution {
  const selectedBytes = textEncoder.encode(selected);
  if (selectedBytes.length === 0 || sha256(selectedBytes) !== anchor.selection_sha256) {
    return { kind: 'stale' };
  }
  if (sha256(source) === anchor.source_sha256) {
    const saved = savedRangeOrNull(anchor, source.length);
    if (!saved) return { kind: 'stale' };
    if (saved.to - saved.from === selectedBytes.length && matchesAt(source, selectedBytes, saved.from)) {
      return { kind: 'resolved', range: saved };
    }
    return { kind: 'stale' };
  }
  const occurrences = exactOccurrences(source, selectedBytes);
  if (occurrences.length === 0) return { kind: 'stale' };
  if (occurrences.length === 1) return { kind: 'resolved', range: occurrences[0]! };
  const prefixBytes = textEncoder.encode(anchor.prefix);
  const suffixBytes = textEncoder.encode(anchor.suffix);
  const contextual = occurrences.filter(
    (occurrence) =>
      hasPrefixContext(source, prefixBytes, occurrence.from) &&
      hasSuffixContext(source, suffixBytes, occurrence.to),
  );
  if (contextual.length === 1) return { kind: 'resolved', range: contextual[0]! };
  return { kind: 'ambiguous', candidates: contextual.length === 0 ? occurrences : contextual };
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Same guard as AnchorResolver.savedRangeOrNull: offsets outside the source
 * (including values above the safe JS integer range) leave the anchor stale.
 */
function savedRangeOrNull(anchor: Anchor, sourceSize: number): Range | null {
  const { start_byte: from, end_byte: to } = anchor;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
  if (from < 0 || to <= from || to > sourceSize) return null;
  return { from, to };
}

function exactOccurrences(source: Uint8Array, selection: Uint8Array): Range[] {
  const found: Range[] = [];
  if (selection.length > source.length) return found;
  for (let start = 0; start + selection.length <= source.length; start++) {
    if (matchesAt(source, selection, start)) {
      found.push({ from: start, to: start + selection.length });
    }
  }
  return found;
}

function matchesAt(source: Uint8Array, value: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + value.length > source.length) return false;
  for (let index = 0; index < value.length; index++) {
    if (source[offset + index] !== value[index]) return false;
  }
  return true;
}

function hasPrefixContext(source: Uint8Array, prefix: Uint8Array, start: number): boolean {
  return prefix.length <= start && matchesAt(source, prefix, start - prefix.length);
}

function hasSuffixContext(source: Uint8Array, suffix: Uint8Array, end: number): boolean {
  return matchesAt(source, suffix, end);
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function lineAtByteOffset(source: Uint8Array, byteOffset: number): number {
  let lines = 1;
  for (let index = 0; index < byteOffset; index++) {
    if (source[index] === NEWLINE_BYTE) lines++;
  }
  return lines;
}

function takeLastCodePoints(text: string, count: number): string {
  return Array.from(text).slice(-count).join('');
}

function takeFirstCodePoints(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}
