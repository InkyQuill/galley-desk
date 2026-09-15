import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { classifyReview } from '../../packages/pocket-format/src/availability';
import { makeAnchor, resolveAnchor, sha256 } from '../../packages/pocket-format/src/anchors';
import { decodeReview, encodeReview } from '../../packages/pocket-format/src/documents';
import type { Anchor, Review } from '../../packages/pocket-format/src/documents';
import { discover } from '../../packages/pocket-format/src/discovery';

/**
 * TypeScript half of the Galley Desk cross-language contract check. Verifies the
 * output.json that the Kotlin DesktopExchangeTest computed from our input.json:
 * reviews round trip through the real codecs, classification id lists agree,
 * AnchorFactory anchors equal makeAnchor and resolve in TypeScript, and
 * BookDiscovery chapter order equals discover(). Runs only under
 * GALLEY_CONTRACTS=1 (vitest.config.ts), after scripts/check-contracts.mjs has
 * produced the artifacts.
 */

/** Case whose fixture carries one deliberately corrupted selection hash. */
const CORRUPTED_HASH_CASE = 'exchange-corrupted-hash';
/** Case exercising chapter_note and a signal comment across the boundary. */
const NOTE_COMMENT_CASE = 'exchange-note-comment';

const exchangeDir = process.env.GALLEY_EXCHANGE_DIR?.trim()
  ? resolve(process.env.GALLEY_EXCHANGE_DIR)
  : resolve('.cache/contracts/exchange');

function readArtifact(name: string): unknown {
  const path = resolve(exchangeDir, name);
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing — run 'npm run test:contracts' to generate the Kotlin exchange artifacts`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

type ExchangeInputCase = { name: string; source: string; review: Review };
type ExchangeOutputCase = {
  name: string;
  review: Review;
  activeEditIds: string[];
  conflictingEditIds: string[];
  unavailableIds: string[];
};
type AnchorInputCase = { name: string; source: string; from: number; to: number };
type AnchorOutputCase = AnchorInputCase & { anchor: Anchor };
type DiscoveryInputCase = { name: string; files: { path: string; text: string }[] };
type DiscoveryOutputCase = { name: string; paths: string[] };

const input = readArtifact('input.json') as {
  cases: ExchangeInputCase[];
  anchorCases: AnchorInputCase[];
  discoveryCases: DiscoveryInputCase[];
};
const output = readArtifact('output.json') as {
  cases: ExchangeOutputCase[];
  anchors: AnchorOutputCase[];
  discovery: DiscoveryOutputCase[];
};

const utf8 = new TextEncoder().encode.bind(new TextEncoder());
const inputCaseByName = new Map(input.cases.map((entry) => [entry.name, entry]));
const outputCaseByName = new Map(output.cases.map((entry) => [entry.name, entry]));
const anchorOutputByName = new Map(output.anchors.map((entry) => [entry.name, entry]));
const discoveryOutputByName = new Map(output.discovery.map((entry) => [entry.name, entry]));

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Records are canonically id-ordered by both codecs; compare order-insensitively. */
function normalized(review: Review): Review {
  return {
    ...review,
    edits: [...review.edits].sort(byId),
    signals: [...review.signals].sort(byId),
  };
}

function decodeCaseReview(review: Review): Review {
  return decodeReview(JSON.stringify(review), review.chapter_id, review.source_path);
}

test('output covers exactly the generated exchange, anchor, and discovery cases', () => {
  expect(output.cases.map((entry) => entry.name)).toEqual(input.cases.map((entry) => entry.name));
  expect(output.anchors.map((entry) => entry.name)).toEqual(input.anchorCases.map((entry) => entry.name));
  expect(output.discovery.map((entry) => entry.name)).toEqual(input.discoveryCases.map((entry) => entry.name));
});

for (const c of output.cases) {
  test(`Kotlin review round trip: ${c.name}`, () => {
    const review = decodeReview(JSON.stringify(c.review), c.review.chapter_id, c.review.source_path);
    expect(JSON.parse(encodeReview(review))).toEqual(c.review);
  });

  test(`classifyReview id lists match Kotlin: ${c.name}`, () => {
    const sourceCase = inputCaseByName.get(c.name);
    if (!sourceCase) throw new Error(`input.json has no exchange case ${c.name}`);
    const state = classifyReview(utf8(sourceCase.source), decodeCaseReview(c.review));
    expect([...state.edits.keys()].sort()).toEqual([...c.activeEditIds].sort());
    expect([...state.conflicting].sort()).toEqual([...c.conflictingEditIds].sort());
    expect([...state.unavailable.keys()].sort()).toEqual([...c.unavailableIds].sort());
  });

  test(`Kotlin canonical review preserves the generated review: ${c.name}`, () => {
    const sourceCase = inputCaseByName.get(c.name);
    if (!sourceCase) throw new Error(`input.json has no exchange case ${c.name}`);
    const fromTypescript = decodeCaseReview(sourceCase.review);
    const fromKotlin = decodeCaseReview(c.review);
    expect(normalized(fromKotlin)).toEqual(normalized(fromTypescript));
  });
}

test(`chapter note and signal comment survive Kotlin: ${NOTE_COMMENT_CASE}`, () => {
  const sourceCase = inputCaseByName.get(NOTE_COMMENT_CASE);
  const outputCase = outputCaseByName.get(NOTE_COMMENT_CASE);
  if (!sourceCase || !outputCase) throw new Error(`${NOTE_COMMENT_CASE} is missing from the exchange artifacts`);
  const reread = decodeCaseReview(outputCase.review);
  expect(reread.chapter_note).toEqual(sourceCase.review.chapter_note);
  for (const signal of sourceCase.review.signals) {
    const saved = reread.signals.find((entry) => entry.id === signal.id);
    if (!saved) throw new Error(`signal ${signal.id} was lost by the Kotlin codec`);
    expect(saved.comment).toEqual(signal.comment);
    expect(saved.type).toEqual(signal.type);
    expect(saved.selected_text).toEqual(signal.selected_text);
  }
});

for (const entry of output.anchors) {
  test(`Kotlin AnchorFactory equals makeAnchor: ${entry.name}`, () => {
    const anchor = makeAnchor(utf8(entry.source), { from: entry.from, to: entry.to });
    expect(anchor).toEqual(entry.anchor);
  });

  test(`Kotlin anchor resolves in TypeScript: ${entry.name}`, () => {
    const source = utf8(entry.source);
    const selected = new TextDecoder().decode(source.subarray(entry.from, entry.to));
    expect(resolveAnchor(source, entry.anchor, selected)).toEqual({
      kind: 'resolved',
      range: { from: entry.from, to: entry.to },
    });
  });
}

for (const entry of output.discovery) {
  test(`BookDiscovery paths equal discover(): ${entry.name}`, () => {
    const sourceCase = input.discoveryCases.find((candidate) => candidate.name === entry.name);
    if (!sourceCase) throw new Error(`input.json has no discovery case ${entry.name}`);
    const proposals = discover(
      sourceCase.files.map((file) => ({ path: file.path, bytes: utf8(file.text) })),
    );
    expect(proposals.map((proposal) => proposal.path)).toEqual(entry.paths);
  });
}

test(`corrupted selection hash leaves both resolvers stale and keeps the record: ${CORRUPTED_HASH_CASE}`, () => {
  const sourceCase = inputCaseByName.get(CORRUPTED_HASH_CASE);
  const outputCase = outputCaseByName.get(CORRUPTED_HASH_CASE);
  if (!sourceCase || !outputCase) throw new Error(`${CORRUPTED_HASH_CASE} is missing from the exchange artifacts`);
  const source = utf8(sourceCase.source);
  const review = decodeCaseReview(sourceCase.review);

  // The damaged fixture: exactly one record whose selection hash does not match
  // its selected text any more. Both codecs must still accept it.
  const records = [...review.edits, ...review.signals];
  const corrupted = records.filter(
    (record) => sha256(utf8('selected_text' in record ? record.selected_text : record.before)) !== record.anchor.selection_sha256,
  );
  expect(corrupted.map((record) => record.id)).toHaveLength(1);
  const damaged = corrupted[0]!;

  // TypeScript resolver: stale, and classification parks the record in unavailable.
  expect(resolveAnchor(source, damaged.anchor, 'selected_text' in damaged ? damaged.selected_text : damaged.before)).toEqual({ kind: 'stale' });
  const state = classifyReview(source, review);
  expect(state.unavailable.get(damaged.id)).toEqual({ kind: 'stale' });

  // Kotlin resolver agrees through output.json.
  expect(outputCase.unavailableIds).toContain(damaged.id);

  // The codec keeps every record, damaged hash included.
  const reencoded = JSON.parse(encodeReview(review)) as Review;
  const kept = [...reencoded.edits, ...reencoded.signals];
  expect(kept.map((record) => record.id).sort()).toEqual(records.map((record) => record.id).sort());
  const survived = kept.find((record) => record.id === damaged.id);
  if (!survived) throw new Error(`record ${damaged.id} was lost by the codec`);
  expect(survived.anchor.selection_sha256).toEqual(damaged.anchor.selection_sha256);
});
