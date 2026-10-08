import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkVersion } from './identity.mjs';
import { expectedAssets } from './assets.mjs';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const version = checkVersion();
const tag = `v${version}`;
assert.equal(process.env.RELEASE_TAG, tag);
assert.match(process.env.RELEASE_SHA ?? '', /^[a-f0-9]{40}$/);
const remoteCommit = JSON.parse(gh('api', `repos/${process.env.GITHUB_REPOSITORY}/commits/${tag}`));
assert.equal(remoteCommit.sha, process.env.RELEASE_SHA, 'Release tag moved during the build');
const files = [...expectedAssets(version), 'SHA256SUMS'].sort();
assert.deepEqual(readdirSync('release-assets').sort(), files);
const releases = JSON.parse(gh('api', `repos/${process.env.GITHUB_REPOSITORY}/releases`, '--paginate', '--slurp')).flat();
const existing = releases.find(release => release.tag_name === tag);
// A retry may fill an unpublished draft, but never replace a published binary.
if (existing && !existing.draft) {
  assert.deepEqual(existing.assets.map(asset => asset.name).sort(), files);
  console.log(`${tag} is already published; assets left unchanged.`);
} else {
  const notes = `# Galley Desk ${version}\n\nDownload the package for your OS and architecture.\n\n[Installation instructions](https://github.com/InkyQuill/galley-desk/blob/${tag}/docs/installation.md)\n\nLinux one-liner:\n\n\`\`\`sh\n(installer=$(mktemp) && trap 'rm -f -- "$installer"' EXIT && curl -fsSL https://github.com/InkyQuill/galley-desk/releases/download/${tag}/install.sh -o "$installer" && bash "$installer" --version ${version})\n\`\`\`\n\nChecksums: SHA256SUMS. Build: ${process.env.RELEASE_SHA}.\n\nmacOS: unsigned, not notarized; native GUI/IME checks NOT RUN.\n\n[Changelog](https://github.com/InkyQuill/galley-desk/blob/${tag}/CHANGELOG.md)\n`;
  const temp = mkdtempSync(path.join(os.tmpdir(), 'galley-release-'));
  try {
    const notesPath = path.join(temp, 'notes.md');
    writeFileSync(notesPath, notes);
    if (!existing) gh('release', 'create', tag, '--verify-tag', '--target', process.env.RELEASE_SHA, '--draft', '--title', `Galley Desk ${version}`, '--notes-file', notesPath);
    gh('release', 'upload', tag, ...files.map(file => `release-assets/${file}`), '--clobber');
    const release = JSON.parse(gh('release', 'view', tag, '--json', 'assets'));
    assert.deepEqual(release.assets.map(asset => asset.name).sort(), files);
    const downloaded = path.join(temp, 'downloaded');
    gh('release', 'download', tag, '--dir', downloaded);
    for (const name of files) {
      const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
      assert.equal(hash(path.join(downloaded, name)), hash(path.join('release-assets', name)), `Uploaded bytes differ: ${name}`);
    }
    gh('release', 'edit', tag, '--draft=false', '--latest', '--notes-file', notesPath);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
