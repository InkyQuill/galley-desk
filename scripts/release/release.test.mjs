import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkVersion, validateReleasePr } from './identity.mjs';
import { expectedAssets } from './assets.mjs';

const root = path.resolve(import.meta.dirname, '../..');
test('release version must agree with runtime, lock and manifest', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'galley-version-'));
  try {
    mkdirSync(path.join(temp, 'apps/desktop'), { recursive: true });
    for (const name of ['version.txt', 'apps/desktop/package.json', 'package-lock.json', '.release-please-manifest.json']) {
      cpSync(path.join(root, name), path.join(temp, name));
    }
    const version = checkVersion(temp);
    writeFileSync(path.join(temp, 'version.txt'), '9.9.9\n');
    assert.throws(() => checkVersion(temp));
    assert.match(version, /^\d+\.\d+\.\d+$/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('only the exact merged release PR authorizes publishing', () => {
  const pr = { merged_at: '2026-10-08', merge_commit_sha: 'abc', base: { ref: 'main', repo: { full_name: 'owner/repo' } }, head: { ref: 'release-please--branches--main', repo: { full_name: 'owner/repo' } } };
  validateReleasePr(pr, 'abc', 'owner/repo');
  assert.throws(() => validateReleasePr(pr, 'def', 'owner/repo'));
  assert.throws(() => validateReleasePr({ ...pr, merged_at: null }, 'abc', 'owner/repo'));
  assert.throws(() => validateReleasePr({ ...pr, head: { ...pr.head, ref: 'feature' } }, 'abc', 'owner/repo'));
  assert.throws(() => validateReleasePr({ ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }, 'abc', 'owner/repo'));
});
test('release inventory covers both architectures and every package format', () => {
  const assets = expectedAssets('1.2.3');
  assert.equal(assets.length, 10);
  assert.equal(new Set(assets).size, 10);
  assert.ok(assets.includes('galley-desk-1.2.3-linux-arm64.deb'));
  assert.ok(assets.includes('galley-desk-1.2.3-1-x86_64.pkg.tar.zst'));
  assert.ok(assets.includes('galley-desk-1.2.3-darwin-x64.zip'));
});

function installerFixture() {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'galley-installer-'));
  const bin = path.join(temp, 'bin');
  mkdirSync(bin);
  const asset = 'galley-desk-1.2.3-linux-x64.zip';
  const content = Buffer.from('fixture archive bytes');
  writeFileSync(path.join(temp, asset), content);
  const sum = createHash('sha256').update(content).digest('hex');
  writeFileSync(path.join(temp, 'SHA256SUMS'), `${sum}  ${asset}\n`);
  writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n', { mode: 0o755 });
  // Only transport is substituted: actual shell selection/checksum handling runs.
  writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
set -eu
url=''
out=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --proto|--proto-redir) shift 2 ;;
    -o) out=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$FIXTURE/requests"
cp "$FIXTURE/\${url##*/}" "$out"
`, { mode: 0o755 });
  return { temp, asset, run: (...args) => spawnSync('bash', [path.join(root, 'scripts/install.sh'), ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: temp },
  }) };
}
test('installer pins latest downloads and rejects corrupted bytes before installation', () => {
  const f = installerFixture();
  try {
    const result = f.run('--download-only', path.join(f.temp, 'download'));
    assert.equal(result.status, 0, result.stderr);
    const requests = readFileSync(path.join(f.temp, 'requests'), 'utf8').trim().split('\n');
    assert.equal(requests.length, 3);
    assert.match(requests[1], /\/download\/v1\.2\.3\/SHA256SUMS$/);
    assert.match(requests[2], /\/download\/v1\.2\.3\/galley-desk-1\.2\.3-linux-x64.zip$/);
    assert.equal(f.run('--from-directory', path.join(f.temp, 'download'), '--download-only', path.join(f.temp, 'offline')).status, 0);
    writeFileSync(path.join(f.temp, f.asset), 'tampered');
    assert.notEqual(f.run('--version', '1.2.3', '--download-only', path.join(f.temp, 'bad')).status, 0);
    assert.notEqual(f.run('--version', '../../bad').status, 0);
    writeFileSync(path.join(f.temp, 'SHA256SUMS'), '');
    assert.notEqual(f.run('--version', '1.2.3', '--download-only', path.join(f.temp, 'missing')).status, 0);
  } finally { rmSync(f.temp, { recursive: true, force: true }); }
});
test('installer and native package hook are valid shell', () => {
  execFileSync('bash', ['-n', 'scripts/install.sh'], { cwd: root });
  execFileSync('sh', ['-n', 'apps/desktop/assets/linux/postinstall.sh'], { cwd: root });
});

test('publisher verifies uploaded bytes before making a draft public', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'galley-publish-'));
  try {
    mkdirSync(path.join(temp, 'apps/desktop'), { recursive: true });
    mkdirSync(path.join(temp, 'bin'));
    mkdirSync(path.join(temp, 'release-assets'));
    for (const name of ['version.txt', 'apps/desktop/package.json', 'package-lock.json', '.release-please-manifest.json']) {
      cpSync(path.join(root, name), path.join(temp, name));
    }
    const version = checkVersion(temp);
    const names = [...expectedAssets(version), 'SHA256SUMS'];
    for (const name of names) writeFileSync(path.join(temp, 'release-assets', name), `fixture ${name}`);
    writeFileSync(path.join(temp, 'bin/gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync('calls', args.join(' ') + '\\n');
if (args[0] === 'api') console.log(args[1].includes('/commits/') ? JSON.stringify({sha:'a'.repeat(40)}) : '[[]]');
else if (args[1] === 'view') console.log(JSON.stringify({assets:fs.readdirSync('release-assets').map(name=>({name}))}));
else if (args[1] === 'download') {
  const dir = args[args.indexOf('--dir')+1];
  fs.cpSync('release-assets',dir,{recursive:true});
  if (process.env.TAMPER) fs.writeFileSync(path.join(dir,'install.sh'),'tampered');
}
`, { mode: 0o755 });
    const run = tamper => spawnSync('node', [path.join(root, 'scripts/release/publish.mjs')], {
      cwd: temp, encoding: 'utf8', env: { ...process.env, PATH: `${temp}/bin:${process.env.PATH}`, RELEASE_TAG: `v${version}`, RELEASE_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'owner/repo', TAMPER: tamper },
    });
    const broken = run('1');
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /Uploaded bytes differ: install.sh/);
    assert.doesNotMatch(readFileSync(path.join(temp, 'calls'), 'utf8'), /release edit/);
    writeFileSync(path.join(temp, 'calls'), '');
    const good = run('');
    assert.equal(good.status, 0, good.stderr);
    assert.match(readFileSync(path.join(temp, 'calls'), 'utf8'), /--draft=false/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
