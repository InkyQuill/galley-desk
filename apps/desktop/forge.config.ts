import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';

// Изготовители дистрибутивов: ZIP для macOS (без подписи — только для CI
// артефактов) и Linux (архив), deb/rpm как дистрибутивы Linux. Squirrel
// (Windows) не входит: приложение адресовано Linux и macOS. Подпись и
// нотаризация macOS не настраиваются — учётных данных нет (см.
// docs/runbooks/release.md); собранное приложение проверяется как
// executable из `out`, а не только dev-вход .vite.
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
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
