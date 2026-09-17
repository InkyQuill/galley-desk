import { defineConfig, type Plugin } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// pocket-format читает свои JSON-схемы через readFileSync(new URL('../schemas/…',
// import.meta.url)). Стандартный конвейер ассетов Vite сворачивает этот URL в
// data:-URL, который readFileSync в Node не читает (ERR_INVALID_URL_SCHEME).
// Плагин сохраняет ссылку на настоящий файл рядом с собранным main.js и
// копирует схемы в каталог сборки.
const SCHEMA_URL_PATTERN = /new URL\((['"])(\.\.\/schemas\/[^'"]+)\1, import\.meta\.url\)/g;

function pocketSchemaFiles(): Plugin {
  let buildRoot = '';
  return {
    name: 'galley:pocket-schema-files',
    enforce: 'pre',
    configResolved(config) {
      // outDir — '.vite/build'; схемы живут уровнем выше, как и ожидает
      // относительный путь '../schemas/…' от main.js.
      buildRoot = path.resolve(config.root, config.build.outDir, '..');
    },
    transform(code, id) {
      if (!id.includes('pocket-format') || !SCHEMA_URL_PATTERN.test(code)) return null;
      SCHEMA_URL_PATTERN.lastIndex = 0;
      // import.meta.url исчезает из кода, поэтому встроенный ассет-плагин
      // Vite больше не превращает схему в data:-URL; в CJS-бандле
      // __filename — это путь к main.js.
      return {
        code: `import { pathToFileURL } from 'node:url';\n${code.replace(
          SCHEMA_URL_PATTERN,
          (_match, _quote, spec: string) => `new URL(${JSON.stringify(spec)}, pathToFileURL(__filename))`,
        )}`,
        map: null,
      };
    },
    async closeBundle() {
      if (!buildRoot) return;
      const require = createRequire(path.resolve(process.cwd(), 'package.json'));
      const entry = require.resolve('@galley-desk/pocket-format');
      // entry — '<пакет>/src/index.ts', каталог пакета на уровень выше.
      const packageDir = path.dirname(path.dirname(entry));
      await mkdir(path.join(buildRoot, 'schemas'), { recursive: true });
      await cp(path.join(packageDir, 'schemas'), path.join(buildRoot, 'schemas'), { recursive: true });
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [pocketSchemaFiles()],
  // forge.config.ts resolves the git revision once, at build time, and
  // stashes it on process.env before Forge invokes this config (same Node
  // process); a source archive without .git falls back to 'unknown' there,
  // never here and never at runtime.
  define: {
    BUILD_REVISION: JSON.stringify(process.env.GALLEY_BUILD_REVISION ?? 'unknown'),
  },
});
