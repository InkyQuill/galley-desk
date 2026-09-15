# Galley shared libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выделить общий пакет тем и проверить публичный API редактора на потребностях Galley Desk.

**Architecture:** Редактор и темы живут в workspace репозитория Galley Editor. Galley Pad подключает опубликованный контракт; прикладные настройки и сохранение остаются в Pad.

**Tech Stack:** TypeScript, npm workspaces, Vitest; Bun и Playwright в Galley Pad

**Spec:** [/home/inky/Development/galley-desk/docs/superpowers/specs/2026-09-15-galley-desk-design.md](/home/inky/Development/galley-desk/docs/superpowers/specs/2026-09-15-galley-desk-design.md) — прочитать вместе с CONTEXT.md и ADR перед выполнением.

## Global Constraints

- Основные платформы: Linux и macOS.
- Обычный ввод создаёт правки в sidecar; исходный Markdown не меняется.
- Схемы v1 не расширяются дополнительными полями Galley Desk.
- Пересечение сохранённых диапазонов не является причиной отвергать весь sidecar при чтении или записи.
- Сигналы могут пересекаться.
- Закрытие книги/проекта очищает оба стека всех глав.
- Renderer работает с включённой изоляцией контекста, без Node integration.
- В рамках реализации разрешены необходимые изменения Galley Editor, Galley Pad и Pocket Editor; существующее поведение этих проектов не является неизменяемым ограничением.
- Правка / сигнал — термины интерфейса; не «предложение». Исходный Markdown сохраняет точные UTF-8 bytes и переводы строк.
- На время выполнения проверить AGENTS.md соответствующего репозитория и рабочее дерево. Существующие изменения других агентов/пользователя не отменять. Изолированный worktree создавать только при выполнении плана.
- Тестовые фрагменты ниже — начальные исполняемые регрессии, алгоритмы — конкретные опорные участки; остальные перечисленные примеры добавлять отдельными короткими циклами RED/GREEN. Не считать один пример полной проверкой задачи.

---

## Корни и карта файлов

E = `/home/inky/Development/editors/galley-editor`, P = `/home/inky/Development/galley-pad`. Префиксы E/P в Files заменять этими корнями. Выполнение не меняет Tauri shell Galley Pad.

- E/packages/galley-editor — существующий пакет после перемещения, с прежними public exports.
- E/packages/galley-themes/src — tokens, catalog, style; без сохранения пользовательских настроек.
- P/src/themes/settings.ts и resolve.ts остаются прикладными.
- E/tests/package-consumer — тест содержимого npm tarballs, исключающий успешный тест только через workspace symlink.

Предварительно прочитать AGENTS.md обоих проектов. В Pad сохранять Bun lockfile и запускать `mise run verify` перед commit. В E все публичные изменения документировать в docs-site.

### Task L1: Workspace и публикуемый пакет тем с сохранением API редактора

**Files:**
- Move: `E/src/` → `E/packages/galley-editor/src/`
- Move: `E/vite.config.ts`, `E/vitest.config.ts`, `E/tsconfig.app.json`, `E/tsconfig.lib.json`, `E/tsconfig.node.json`, `E/tsconfig.json`, `E/index.html` → `E/packages/galley-editor/`
- Create: `E/packages/galley-editor/package.json`
- Create: `E/packages/galley-themes/package.json`, `E/packages/galley-themes/tsconfig.json`
- Create: `E/packages/galley-themes/src/tokens.ts`, `catalog.ts`, `style.ts`, `index.ts`, `catalog.test.ts`, `style.test.ts`
- Modify: `E/package.json`, `E/package-lock.json`, `E/.releaserc.json`, `E/.github/workflows/release.yml`, `E/playwright.config.ts`, `E/.storybook/main.ts`, `E/.storybook/preview.ts`, `E/scripts/verify-publish.sh`
- Create/Test: `E/tests/package-consumer/exports.test.mjs`
- Create: `E/scripts/prepare-workspace-release.mjs`
- Modify: `E/docs-site/src/content/docs/index.mdx`, `E/AGENTS.md`, `E/README.md`

**Interfaces:**
- Consumes: exact current P/src/themes/{tokens,catalog,style}.ts; existing E/package.json exports.
- Produces: `@inkyquill/galley-themes` re-exports ThemeId, ThemeScheme, ThemeTokens, ThemeDefinition, ThemeCssVariables, getTheme, listThemesByScheme, isThemeId, BUILT_IN_THEMES, default theme IDs and themeToCssVariables. Existing editor package and `@inkyquill/galley-editor/style.css` remain importable.

- [ ] **Step 1: Зафиксировать регрессию**

Новый тест темы с реальной палитрой:
```ts
import { expect, test } from 'vitest';
import { getTheme, themeToCssVariables } from './index';
test('preserves Galley light colors', () => {
  const theme = getTheme('galley-light');
  expect(theme).toBeDefined();
  expect(theme!.scheme).toBe('light');
  expect(themeToCssVariables(theme!)['--app-bg']).toBe('#f6f4ef');
});
```
Добавить проверку --ge-color-bg по исходному style.test.ts; никакие DOM методы не требуются.

- [ ] **Step 2: Проверить RED**

Run: `npm test --workspace @inkyquill/galley-themes`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Скопировать значения tokens/catalog/style из Pad без ручной перепечатки палитр. Из ThemeCssVariables убрать React dependency, сохранив совместимость plain style object:
```ts
export type ThemeCssVariables = { colorScheme: string } & Record<`--${string}`, string>;
```
```ts
export * from './tokens';
export * from './catalog';
export * from './style';
```
Root package сделать private, scripts делегируют workspace редактора; корневые docs-site, release и hook scripts остаются. Theme package собирается `tsc` с module/moduleResolution NodeNext и относительными `.js` imports в TS-исходниках для запуска из Node; exports ведут в dist/index.js и .d.ts. Editor package сохраняет исходные peerDependencies, sideEffects, exports и files.

Релиз остаётся с одной версией: `prepare-workspace-release.mjs VERSION` проверяет semver, выставляет одинаковую version двум package.json, обновляет lockfile и выполняет сборку обоих пакетов. В semantic-release настроить npm plugin дважды с разными pkgRoot; private root не публиковать. Existing docs sync и assets списка git-plugin обновить на новые пути. Исправить пути Storybook/test/demo по фактическим tracked config, не копировать node_modules. Публикацию проверять dry-run без фактического выпуска.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test --workspace @inkyquill/galley-themes`
Expected: PASS.

- [ ] `npm run build:lib` из E продолжает работать; `npm run test`, `npm run lint`, docs build и Storybook build не теряют старые тесты.
- [ ] `npm pack --workspace @inkyquill/galley-editor --pack-destination /tmp` и themes; в изолированном temp consumer установить оба tarballs и React/CM peers, проверить import API, .d.ts и style.css.
- [ ] `node --test tests/package-consumer/exports.test.mjs` вызывает pack во временную папку и проверяет files без публикации; конкретные tarball пути получает из `npm pack --json`, не угадывает version.
- [ ] Обновить инструкции нового workspace и release dry-run.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "refactor: extract shared galley themes workspace"
```

### Task L2: Перевести Galley Pad на общие темы

**Files:**
- Modify: `P/package.json`, `P/bun.lock`
- Modify: `P/src/themes/tokens.ts`, `P/src/themes/catalog.ts`, `P/src/themes/style.ts`
- Test: `P/src/themes/catalog.test.ts`, `P/src/themes/style.test.ts`, `P/src/themes/resolve.test.ts`
- Create/Test: `P/tests/integration/shared-themes.spec.ts`
- Modify: `P/docs/known-issues.md`, `P/README.md`

**Interfaces:**
- Consumes: L1 exports. Produces: unchanged Pad imports and persisted theme IDs; thin re-exports replace duplicated data. settings/resolve and font selection stay in Pad.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { expect, test } from '@playwright/test';
test('theme still styles the real editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-editor').first()).toBeVisible();
  const bg = await page.locator('.cm-editor').first().evaluate(el =>
    getComputedStyle(el).getPropertyValue('--ge-color-bg').trim());
  expect(bg).not.toBe('');
});
```
Добавить к существующим theme unit tests сравнение `getTheme('galley-light')` с экспортом нового пакета и сохранение старых IDs; первый RED — отсутствующий пакет.

- [ ] **Step 2: Проверить RED**

Run: `bun run test:unit src/themes`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Переэкспортировать ровно прежние имена, не менять десятки consumers:
```ts
// src/themes/catalog.ts
export { getTheme, listThemesByScheme, isThemeId, BUILT_IN_THEMES,
  DEFAULT_CONSTANT_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID
} from '@inkyquill/galley-themes';
```
tokens.ts — type exports; style.ts — themeToCssVariables. Использовать tarball для локального теста, после совместимого выпуска `bun add --exact @inkyquill/galley-themes@VERSION` с реально выпущенной версией. VERSION берётся из результата L1, не записывается строкой VERSION в manifest. При несовместимом readonly типе сделать вход style-функции readonly, а не cast через any.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `bun run test:unit src/themes`
Expected: PASS.

- [ ] `bun run test:integration tests/integration/shared-themes.spec.ts`, без mock Galley Editor.
- [ ] `mise run verify`; проверить переключение светлой/тёмной темы и сохранённого шрифта в существующем интерфейсе Pad.
- [ ] Убедиться, что root dependencies не содержат абсолютный file: путь.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "refactor(themes): consume shared galley palette package"
```

### Task L3: Проверить транзакции и позиции через существующий публичный API

**Files:**
- Create/Test: `E/packages/galley-editor/src/consumer-contract.test.ts`
- Create: `E/docs-site/src/content/docs/guides/document-transactions.md`
- Modify only if test exposes missing capability: `E/packages/galley-editor/src/types.ts`, `controller.ts`, `components/index.ts`

**Interfaces:**
- Consumes: GalleyHandle.getSelection(), extensions?: Extension[], EditorView.updateListener, existing lifecycle.
- Produces: documented extension-based subscription to ViewUpdate.transactions; UTF-16 positions in editor document. No canonical-byte API added speculatively. Fixing a demonstrated missing hook stays in this task with regression.

- [ ] **Step 1: Зафиксировать регрессию**

Использовать существующую controller test setup для создания редактора; опорное утверждение:
```ts
const changes: { from: number; to: number; insert: string }[] = [];
const observer = EditorView.updateListener.of(update => {
  for (const tr of update.transactions) {
    tr.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
  }
});
// Передать observer через extensions, установить value='**кот**', select(2,5), insertText('кит').
expect(changes.at(-1)).toEqual({ from: 2, to: 5, insert: 'кит' });
```
Импорты и создание controller взять из существующего controller.test.ts после move L1. Повторить при live preview и reconfiguration; тест должен подтвердить отсутствие лишней транзакции при смене callback.

- [ ] **Step 2: Проверить RED**

Run: `npm test --workspace @inkyquill/galley-editor -- src/consumer-contract.test.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Публичный пример интеграции:
```ts
const observer = EditorView.updateListener.of(({ transactions }) => {
  for (const tr of transactions) {
    if (!tr.docChanged) continue;
    tr.changes.iterChanges((from, to, _a, _b, text) => {
      console.debug({ from, to, insertedLength: text.length });
    });
  }
});
```
В документации объяснить, что это координаты текущего Markdown, скрытые markers остаются частью документа; tr.startState нужен для старых позиций, programmatic replacement требует Annotation во избежание feedback-loop. Не логировать содержимое рукописи. Если тест уже GREEN, зафиксировать характеристику и документацию, не вводить фиктивный RED и новый API ради него.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test --workspace @inkyquill/galley-editor -- src/consumer-contract.test.ts`
Expected: PASS.

- [ ] Проверить emoji, CRLF нормализацию CM и выделение через скрытые marks; правило сохранения исходных EOL остаётся обязанностью Desk.
- [ ] Проверить полную библиотечную сборку и документацию. Любое исправление Galley повторно проверить в Pad.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "test(editor): document transaction and selection contract"
```
