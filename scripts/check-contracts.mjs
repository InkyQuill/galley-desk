#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cross-language contract orchestrator: generate input.json with the
 * TypeScript codec, run the Kotlin DesktopExchangeTest over it, then verify
 * the Kotlin output with tests/contracts/exchange.test.ts. Every failure
 * exits non-zero; nothing is skipped silently.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exchangeDir = resolve(repoRoot, '.cache/contracts/exchange');
const exchangeTestClass = join(
  'app/src/test/java/net/inkyquill/pocketeditor/contracts/DesktopExchangeTest.kt',
);

function fail(message) {
  console.error(`check-contracts: ${message}`);
  process.exit(1);
}

function readPinnedPocket() {
  const baseline = JSON.parse(readFileSync(join(repoRoot, 'tests/contracts/baseline.json'), 'utf8'));
  const pinned = baseline['pocket-editor'];
  if (typeof pinned === 'string') return { sha: pinned, branch: undefined };
  if (typeof pinned?.sha === 'string') return { sha: pinned.sha, branch: pinned.branch };
  return fail('tests/contracts/baseline.json has no pocket-editor sha');
}

function assertPocketCheckout(pocketDir, origin) {
  if (!existsSync(join(pocketDir, 'gradlew'))) {
    fail(`${origin} has no gradlew — not a Pocket Editor checkout`);
  }
  if (!existsSync(join(pocketDir, exchangeTestClass))) {
    fail(
      `${origin} does not contain ${exchangeTestClass} — the exchange test class is mandatory here, refusing to skip`,
    );
  }
}

function resolvePocketDir(pinned) {
  const override = process.env.POCKET_EDITOR_DIR?.trim();
  if (override) {
    const dir = resolve(override);
    assertPocketCheckout(dir, `POCKET_EDITOR_DIR (${dir})`);
    return dir;
  }
  const pinnedCheckout = resolve(repoRoot, '.cache/contracts/pocket-editor');
  if (existsSync(pinnedCheckout)) {
    assertPocketCheckout(pinnedCheckout, `pinned checkout (${pinnedCheckout})`);
    const head = spawnSync('git', ['-C', pinnedCheckout, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.status !== 0) fail(`cannot read HEAD of pinned checkout ${pinnedCheckout}: ${head.stderr}`);
    if (head.stdout.trim() !== pinned.sha) {
      fail(
        `pinned checkout ${pinnedCheckout} is at ${head.stdout.trim()}, baseline pins ${pinned.sha}` +
          `(branch ${pinned.branch ?? 'n/a'}) — move it to the pinned revision`,
      );
    }
    return pinnedCheckout;
  }
  fail(
    'no Pocket Editor sources found: set POCKET_EDITOR_DIR to a checkout containing ' +
      `${exchangeTestClass}, or create the pinned checkout, e.g. ` +
      `git -C <pocket-editor-clone> worktree add --detach ${pinnedCheckout} ${pinned.sha}`,
  );
}

function run(step, command, args, options) {
  console.log(`[contracts] ${step}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) fail(`${step} failed to start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pinned = readPinnedPocket();
const pocketDir = resolvePocketDir(pinned);

mkdirSync(exchangeDir, { recursive: true });
// A stale artifact must never be mistaken for a fresh Kotlin answer.
rmSync(join(exchangeDir, 'input.json'), { force: true });
rmSync(join(exchangeDir, 'output.json'), { force: true });

run(
  'generate input',
  join(repoRoot, 'node_modules/.bin/tsx'),
  [join(repoRoot, 'tests/contracts/generate.ts')],
  { cwd: repoRoot },
);

run(
  'kotlin exchange test',
  './gradlew',
  ['testDebugUnitTest', '--tests', '*DesktopExchangeTest', '--rerun-tasks'],
  { cwd: pocketDir, env: { ...process.env, GALLEY_EXCHANGE_DIR: exchangeDir } },
);

if (!existsSync(join(exchangeDir, 'output.json'))) {
  fail(`${exchangeTestClass} in ${pocketDir} passed but wrote no output.json in ${exchangeDir}`);
}

run(
  'typescript exchange tests',
  'npm',
  ['test', '--', 'tests/contracts/exchange.test.ts'],
  { cwd: repoRoot, env: { ...process.env, GALLEY_CONTRACTS: '1', GALLEY_EXCHANGE_DIR: exchangeDir } },
);

console.log('[contracts] OK');
