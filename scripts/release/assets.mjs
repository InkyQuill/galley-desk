import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkVersion } from './identity.mjs';

export const targets = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];
export function expectedAssets(version) {
  return targets.flatMap(target => (target.startsWith('linux') ? ['zip', 'deb', 'rpm'] : ['zip'])
    .map(ext => `galley-desk-${version}-${target}.${ext}`)).concat(`galley-desk-${version}-1-x86_64.pkg.tar.zst`, 'install.sh');
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const [mode, target] = process.argv.slice(2);
if (process.argv[1]?.endsWith('/assets.mjs')) {
  const version = checkVersion();
  mkdirSync('release-assets', { recursive: true });
  if (mode === 'collect') {
    assert.ok(targets.includes(target));
    assert.equal(target, `${process.platform}-${process.arch}`, 'Build must run on the matching native runner');
    const built = files('apps/desktop/out/make');
    for (const ext of target.startsWith('linux') ? ['zip', 'deb', 'rpm'] : ['zip']) {
      const found = built.filter(file => file.endsWith(`.${ext}`));
      assert.equal(found.length, 1, `Expected exactly one ${ext}`);
      cpSync(found[0], `release-assets/galley-desk-${version}-${target}.${ext}`);
    }
  } else {
    assert.equal(mode, 'manifest');
    cpSync('scripts/install.sh', 'release-assets/install.sh');
    const expected = expectedAssets(version).sort();
    assert.deepEqual(readdirSync('release-assets').sort(), expected, 'Incomplete or unexpected release payload');
    const sums = expected.map(name => `${createHash('sha256').update(readFileSync(`release-assets/${name}`)).digest('hex')}  ${name}\n`).join('');
    writeFileSync('release-assets/SHA256SUMS', sums);
  }
}
