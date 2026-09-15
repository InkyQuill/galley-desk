import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAnchor } from '../../packages/pocket-format/src/anchors';
import type { Anchor } from '../../packages/pocket-format/src/documents';
import { encodeReview } from '../../packages/pocket-format/src/documents';
import type { Edit, Review, Signal, SignalType } from '../../packages/pocket-format/src/documents';
import { discover } from '../../packages/pocket-format/src/discovery';

/**
 * Generates .cache/contracts/exchange/input.json for the Kotlin
 * DesktopExchangeTest from the synthetic manuscripts in cases.json. Every
 * review is built with the Galley Desk codec (makeAnchor + encodeReview), so
 * the Kotlin side always consumes exactly what TypeScript produces. Each
 * anchor and discovery case is pre-validated here, before gradle runs.
 */

type ExpandedSource = string | {
  fill: string;
  count: number;
  middle: string;
  tail: string;
  tailCount: number;
};

type SignalSpec = {
  id: string;
  type: SignalType;
  selected: string;
  comment: string;
  /** Anchor against another manuscript: the selection never resolves here. */
  staleAgainst?: string;
  /** Damage selection_sha256 after construction (resolver corruption fixture). */
  corruptSelectionHash?: boolean;
};

type EditSpec = {
  id: string;
  before: string;
  after: string;
  staleAgainst?: string;
  corruptSelectionHash?: boolean;
};

type ExchangeCaseSpec = {
  name: string;
  source: string;
  chapterId: string;
  sourcePath: string;
  chapterNote?: string;
  signals?: SignalSpec[];
  edits?: EditSpec[];
};

type AnchorCaseSpec = {
  name: string;
  source: ExpandedSource;
  from: number;
  to: number;
};

type DiscoveryCaseSpec = {
  name: string;
  files: { path: string; text: string }[];
  expectedPaths: string[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exchangeDir = process.env.GALLEY_EXCHANGE_DIR?.trim()
  ? resolve(process.env.GALLEY_EXCHANGE_DIR)
  : resolve(repoRoot, '.cache/contracts/exchange');

const utf8 = new TextEncoder().encode.bind(new TextEncoder());

function expandSource(spec: ExpandedSource): string {
  if (typeof spec === 'string') return spec;
  return spec.fill.repeat(spec.count) + spec.middle + spec.tail.repeat(spec.tailCount);
}

/** The single byte range of `selection` inside `source`; ambiguity is an error. */
function soleRange(source: string, selection: string): { from: number; to: number } {
  const haystack = Buffer.from(utf8(source));
  const needle = Buffer.from(utf8(selection));
  const found: { from: number; to: number }[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push({ from: at, to: at + needle.length });
  }
  if (found.length !== 1) {
    throw new Error(
      `selection ${JSON.stringify(selection)} must occur exactly once, found ${found.length} times in ${JSON.stringify(source)}`,
    );
  }
  return found[0]!;
}

function buildAnchor(anchorSource: string, selection: string): Anchor {
  return makeAnchor(utf8(anchorSource), soleRange(anchorSource, selection));
}

/** Flip the first hex digit: still a valid SHA-256 string, but no longer true. */
function corruptSelectionHash(anchor: Anchor): Anchor {
  const first = anchor.selection_sha256[0] === '0' ? '1' : '0';
  return { ...anchor, selection_sha256: first + anchor.selection_sha256.slice(1) };
}

function occursExactlyOnce(source: string, selection: string): boolean {
  try {
    soleRange(source, selection);
    return true;
  } catch {
    return false;
  }
}

function buildSignals(caseSpec: ExchangeCaseSpec): Signal[] {
  return (caseSpec.signals ?? []).map((spec) => {
    if (!spec.staleAgainst && !occursExactlyOnce(caseSpec.source, spec.selected)) {
      throw new Error(`${caseSpec.name}: signal ${spec.id} selection does not occur in the case source`);
    }
    let anchor = buildAnchor(spec.staleAgainst ?? caseSpec.source, spec.selected);
    if (spec.corruptSelectionHash) anchor = corruptSelectionHash(anchor);
    return {
      id: spec.id,
      type: spec.type,
      selected_text: spec.selected,
      anchor,
      comment: spec.comment,
    };
  });
}

function buildEdits(caseSpec: ExchangeCaseSpec): Edit[] {
  return (caseSpec.edits ?? []).map((spec) => {
    if (!spec.staleAgainst && !occursExactlyOnce(caseSpec.source, spec.before)) {
      throw new Error(`${caseSpec.name}: edit ${spec.id} before text does not occur in the case source`);
    }
    let anchor = buildAnchor(spec.staleAgainst ?? caseSpec.source, spec.before);
    if (spec.corruptSelectionHash) anchor = corruptSelectionHash(anchor);
    return { id: spec.id, before: spec.before, after: spec.after, anchor };
  });
}

function buildReview(caseSpec: ExchangeCaseSpec): Review {
  const review: Review = {
    schema_version: 1,
    chapter_id: caseSpec.chapterId,
    source_path: caseSpec.sourcePath,
    chapter_note: caseSpec.chapterNote ?? '',
    signals: buildSignals(caseSpec),
    edits: buildEdits(caseSpec),
  };
  // Fails fast on any codec violation before the Kotlin side ever runs.
  return JSON.parse(encodeReview(review)) as Review;
}

const spec = JSON.parse(
  readFileSync(resolve(repoRoot, 'tests/contracts/cases.json'), 'utf8'),
) as {
  exchangeCases: ExchangeCaseSpec[];
  anchorCases: AnchorCaseSpec[];
  discoveryCases: DiscoveryCaseSpec[];
};

const input = {
  cases: spec.exchangeCases.map((caseSpec) => ({
    name: caseSpec.name,
    source: caseSpec.source,
    review: buildReview(caseSpec),
  })),
  anchorCases: spec.anchorCases.map((caseSpec) => {
    const source = expandSource(caseSpec.source);
    makeAnchor(utf8(source), { from: caseSpec.from, to: caseSpec.to });
    return { name: caseSpec.name, source, from: caseSpec.from, to: caseSpec.to };
  }),
  discoveryCases: spec.discoveryCases.map((caseSpec) => {
    const paths = discover(
      caseSpec.files.map((file) => ({ path: file.path, bytes: utf8(file.text) })),
    ).map((proposal) => proposal.path);
    if (JSON.stringify(paths) !== JSON.stringify(caseSpec.expectedPaths)) {
      throw new Error(
        `${caseSpec.name}: discover() proposed ${JSON.stringify(paths)}, expected ${JSON.stringify(caseSpec.expectedPaths)}`,
      );
    }
    return { name: caseSpec.name, files: caseSpec.files };
  }),
};

mkdirSync(exchangeDir, { recursive: true });
const target = resolve(exchangeDir, 'input.json');
writeFileSync(target, `${JSON.stringify(input, null, 2)}\n`);
console.log(`exchange input: ${target}`);
console.log(
  `cases: ${input.cases.map((entry) => entry.name).join(', ')}; ` +
    `anchors: ${input.anchorCases.length}; discovery: ${input.discoveryCases.length}`,
);
