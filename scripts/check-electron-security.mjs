import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import scan from '@doyensec/electronegativity';

const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = path.join(root, 'apps/desktop');
const output = path.join(root, 'test-results/security');
const input = await mkdtemp(path.join(os.tmpdir(), 'galley-security-'));

try {
  // Scan owned sources and the actual CSP, without stale builds, dependencies,
  // test fixtures or books. This also keeps the scan independent of packaging.
  const sourceRoot = path.join(input, 'apps/desktop');
  await mkdir(sourceRoot, { recursive: true });
  await cp(path.join(desktop, 'src'), path.join(sourceRoot, 'src'), { recursive: true });
  await cp(path.join(desktop, 'index.html'), path.join(sourceRoot, 'index.html'));
  const manifest = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  await mkdir(output, { recursive: true });
  await Promise.all(['electronegativity.json', 'electronegativity.sarif'].map(name => rm(path.join(output, name), { force: true })));
  const result = await scan({
    input,
    electronVersionOverride: manifest.devDependencies.electron,
    isRelative: true,
    output: path.join(output, 'electronegativity.sarif'),
    isSarif: true,
  });
  await writeFile(path.join(output, 'electronegativity.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Electronegativity: ${result.atomicChecks} atomic / ${result.globalChecks} global checks; ${result.issues.length} findings; ${result.errors.length} parser errors.`);
  for (const issue of result.issues) {
    console.log(`${issue.severity.name} ${issue.id} ${issue.file}:${issue.location?.line ?? 0}`);
  }
  console.log('Reports: test-results/security/. Findings require review; a successful scan is not a security clearance.');
  // Do not silently report success when the old parser misses current syntax.
  if (result.errors.length) {
    console.error(JSON.stringify(result.errors, null, 2));
    process.exitCode = 1;
  }
} finally {
  await rm(input, { recursive: true, force: true });
}
