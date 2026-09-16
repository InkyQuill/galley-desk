import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchPackaged } from './packaged-app';

test('packaged launcher reports a missing executable without an unhandled spawn error', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-missing-executable-'));
  try {
    await expect(launchPackaged(path.join(profile, 'missing-executable'), profile)).rejects.toThrow(/Cannot spawn packaged executable.*ENOENT/);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test('packaged launcher bounds endpoint discovery and kills a child that ignores SIGTERM', async () => {
  test.skip(process.platform === 'win32', 'POSIX executable fixture; release platforms are Linux/macOS');
  test.setTimeout(45_000);
  const profile = await mkdtemp(path.join(tmpdir(), 'galley-stuck-executable-'));
  const executable = path.join(profile, 'stuck-executable');
  const pidFile = path.join(profile, 'pid');
  await writeFile(executable, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
  await chmod(executable, 0o755);
  try {
    await expect(launchPackaged(executable, profile)).rejects.toThrow('No packaged CDP endpoint within');
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
  } finally {
    // If the regression fails, still leave no synthetic child behind.
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
    if (pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
    await rm(profile, { recursive: true, force: true });
  }
});
