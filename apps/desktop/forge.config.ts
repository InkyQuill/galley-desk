import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Diagnostics записывает короткую ревизию сборки как непрозрачный build-тег
// (docs/superpowers/plans/2026-09-17-diagnostics.md, Task 2): читается один
// раз здесь, на этапе сборки, а не через runtime shell-out из main-процесса
// упакованного приложения. Source-архив без .git (например, экспорт из CI
// артефакта) не должен ронять сборку -- отсутствие git или репозитория
// вырождается в 'unknown'. vite.main.config.ts подхватывает значение через
// process.env, так как Forge выполняет vite build в этом же процессе Node.
function resolveBuildRevision(): string {
  try {
    const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return revision || 'unknown';
  } catch {
    return 'unknown';
  }
}
process.env.GALLEY_BUILD_REVISION = resolveBuildRevision();

// Изготовители дистрибутивов: ZIP для macOS (без подписи — только для CI
// артефактов) и Linux (архив), deb/rpm как дистрибутивы Linux. Squirrel
// (Windows) не входит: приложение адресовано Linux и macOS. Подпись и
// нотаризация macOS не настраиваются — учётных данных нет (см.
// docs/runbooks/release.md); собранное приложение проверяется как
// executable из `out`, а не только dev-вход .vite.
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Chromium's SUID wrapper splits an unquoted helper path on spaces.
    // Keep Linux artifact paths shell-safe; productName remains Galley Desk.
    ...(process.platform === 'linux' ? {name: 'galley-desk', executableName: 'galley-desk'} : {}),
    icon: path.resolve(
      'assets/branding/generated',
      process.platform === 'darwin' ? 'galley-desk-icon.icns' : 'galley-desk-icon.png',
    ),
    extraResource: [path.resolve('assets/branding')],
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDeb({}, ['linux']),
    new MakerRpm({}, ['linux']),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be
      // Main process, Preload scripts, Worker process, etc.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
