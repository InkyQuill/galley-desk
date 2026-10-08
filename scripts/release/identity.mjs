import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

export function checkVersion(root = '.') {
  const read = name => JSON.parse(readFileSync(`${root}/${name}`, 'utf8'));
  const version = readFileSync(`${root}/version.txt`, 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(read('apps/desktop/package.json').version, version);
  assert.equal(read('package-lock.json').packages['apps/desktop'].version, version);
  assert.equal(read('.release-please-manifest.json')['.'], version);
  return version;
}

export function validateReleasePr(pr, sha, repository) {
  assert.ok(pr.merged_at, 'Release PR must be merged');
  assert.equal(pr.merge_commit_sha, sha, 'Release must use the exact merge commit');
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.base.repo.full_name, repository);
  assert.equal(pr.head.repo.full_name, repository);
  assert.match(pr.head.ref, /^release-please--branches--main(?:--.*)?$/);
}

// Retry resolves the existing tag, never the moving main branch.
if (process.argv[1]?.endsWith('/identity.mjs')) {
  const version = checkVersion();
  if (process.argv.includes('--local')) {
    console.log(`Release version: ${version}`);
  } else {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const sha = git('rev-parse', 'HEAD');
    const tag = `v${version}`;
    const repository = process.env.GITHUB_REPOSITORY;
    assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
    if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, tag);
    git('merge-base', '--is-ancestor', sha, 'origin/main');
    const prs = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/commits/${sha}/pulls`], { encoding: 'utf8' }));
    const pr = prs.find(pr => pr.merged_at && pr.head.ref.startsWith('release-please--branches--main'));
    assert.ok(pr, 'Commit is not a merged release-please PR');
    validateReleasePr(pr, sha, repository);
    const previous = git('show', `${sha}^:version.txt`);
    assert.notEqual(previous, version, 'Release merge must change version.txt');
    const existing = execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim();
    if (existing) assert.equal(git('rev-parse', `${tag}^{commit}`), sha, 'Tag already points elsewhere');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nsha=${sha}\npr=${pr.number}\n`);
    console.log(`${tag} at ${sha}`);
  }
}
