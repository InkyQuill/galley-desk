import { Node, Parser } from 'commonmark';
import type { Manifest } from './documents';

export type DiscoveryFile = {
  path: string;
  bytes: Uint8Array;
};

export type ChapterProposal = {
  path: string;
  title: string;
};

type ChapterMetadata = {
  title: string;
  number: number | null;
};

const parser = new Parser();

/**
 * Proposes chapters from ordinary Markdown files, mirroring
 * BookDiscovery.propose: only direct-child "*.md" files that do not start
 * with a dot are considered; files are ordered by front matter number
 * (numbered first, then unnumbered) with a natural path comparison, known
 * manifest chapter paths and ignored files are excluded, and the remaining
 * proposals keep that order.
 */
export function discover(
  files: readonly DiscoveryFile[],
  manifest?: Manifest,
): ChapterProposal[] {
  const ordinary = files
    .filter(isOrdinaryMarkdown)
    .map((file) => ({ file, metadata: extractMetadata(file.path, file.bytes) }));
  const knownPaths = new Set<string>();
  if (manifest) {
    for (const chapter of manifest.chapters) knownPaths.add(chapter.path);
    for (const ignored of manifest.ignored_files) knownPaths.add(ignored);
  }
  const ordered = ordinary.sort(compareChapters);
  return ordered
    .filter(({ file }) => !knownPaths.has(file.path))
    .map(({ file, metadata }) => ({ path: file.path, title: metadata.title }));
}

function isOrdinaryMarkdown(file: DiscoveryFile): boolean {
  return (
    file.path.endsWith('.md') &&
    !file.path.startsWith('.') &&
    !file.path.includes('/') &&
    !file.path.includes('\\')
  );
}

function compareChapters(
  left: { file: DiscoveryFile; metadata: ChapterMetadata },
  right: { file: DiscoveryFile; metadata: ChapterMetadata },
): number {
  const leftNumber = left.metadata.number;
  const rightNumber = right.metadata.number;
  if (leftNumber !== null && rightNumber === null) return -1;
  if (leftNumber === null && rightNumber !== null) return 1;
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
    return leftNumber < rightNumber ? -1 : 1;
  }
  return naturalCompare(left.file.path, right.file.path);
}

/** Mirrors BookDiscovery.naturalCompare. */
export function naturalCompare(left: string, right: string): number {
  const leftParts = left.match(/\d+|\D+/g) ?? [];
  const rightParts = right.match(/\d+|\D+/g) ?? [];
  const common = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < common; index++) {
    const a = leftParts[index]!;
    const b = rightParts[index]!;
    let comparison: number;
    if (isAsciiDigit(a[0]) && isAsciiDigit(b[0])) {
      const trimmedA = a.replace(/^0+/, '');
      const trimmedB = b.replace(/^0+/, '');
      comparison = trimmedA.length === trimmedB.length
        ? compareCodeUnits(trimmedA === '' ? '0' : trimmedA, trimmedB === '' ? '0' : trimmedB)
        : compareCodeUnits(String(trimmedA.length), String(trimmedB.length));
    } else {
      comparison = compareIgnoreCase(a, b);
    }
    if (comparison !== 0) return comparison;
  }
  if (leftParts.length !== rightParts.length) {
    return leftParts.length < rightParts.length ? -1 : 1;
  }
  return compareCodeUnits(left, right);
}

function isAsciiDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Mirrors Kotlin String.compareTo(ignoreCase = true). */
function compareIgnoreCase(left: string, right: string): number {
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (a === b) continue;
    const upperA = a.toUpperCase();
    const upperB = b.toUpperCase();
    if (upperA !== upperB) return compareCodeUnits(upperA, upperB);
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (lowerA !== lowerB) return compareCodeUnits(lowerA, lowerB);
  }
  return compareCodeUnits(String(left.length), String(right.length));
}

/** Mirrors ChapterTitleExtractor.extract. */
function extractMetadata(path: string, bytes: Uint8Array): ChapterMetadata {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = splitLines(text);
  let bodyStart = 0;
  let number: number | null = null;
  let title: string | null = null;
  if (lines[0] === '---') {
    const closeIndex = lines.slice(1).indexOf('---');
    const end = closeIndex < 0 ? -1 : closeIndex + 1;
    if (end > 0) {
      const values = new Map<string, string>();
      for (const line of lines.slice(1, end)) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        values.set(line.slice(0, separator).trim(), stripQuotes(line.slice(separator + 1).trim()));
      }
      const rawNumber = values.get('number');
      number = rawNumber === undefined ? null : parseIntOrNull(rawNumber);
      const rawTitle = values.get('title');
      title = rawTitle !== undefined && !isBlank(rawTitle) ? rawTitle : null;
      bodyStart = end + 1;
    }
  }
  const heading = firstLevelOneHeading(lines.slice(bodyStart).join('\n'));
  return { title: title ?? heading ?? path.replace(/\.md$/, ''), number };
}

/** Kotlin lineSequence: splits on CR, LF, CRLF without a trailing empty line. */
function splitLines(text: string): string[] {
  const parts = text.split(/\r\n|\r|\n/);
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function stripQuotes(value: string): string {
  return removeSurrounding(removeSurrounding(value, '"'), "'");
}

function removeSurrounding(value: string, delimiter: string): string {
  if (value.length >= delimiter.length * 2 && value.startsWith(delimiter) && value.endsWith(delimiter)) {
    return value.slice(delimiter.length, value.length - delimiter.length);
  }
  return value;
}

/** Kotlin String.toIntOrNull for radix 10 with the Int range. */
function parseIntOrNull(value: string): number | null {
  if (!/^[+-]?\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < -2147483648 || parsed > 2147483647) return null;
  return parsed;
}

function isBlank(value: string): boolean {
  return /^\s*$/.test(value);
}

function firstLevelOneHeading(source: string): string | null {
  const headings: Node[] = [];
  collectHeadings(parser.parse(source), headings);
  const heading = headings.find((node) => node.level === 1);
  if (heading === undefined) return null;
  const text = plainText(heading).trim();
  return text !== '' ? text : null;
}

function collectHeadings(node: Node, output: Node[]): void {
  for (let child = node.firstChild; child !== null; child = child.next) {
    if (child.type === 'heading') output.push(child);
    collectHeadings(child, output);
  }
}

function plainText(node: Node): string {
  let result = '';
  switch (node.type) {
    case 'text':
    case 'code':
      result += node.literal ?? '';
      break;
    case 'softbreak':
    case 'linebreak':
      result += ' ';
      break;
    default:
      break;
  }
  for (let child = node.firstChild; child !== null; child = child.next) {
    result += plainText(child);
  }
  return result;
}
