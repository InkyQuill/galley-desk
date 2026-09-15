# Разработка

## Структура репозитория

- `packages/` — библиотечные npm-пакеты (workspace `packages/*`);
- `apps/` — исполняемые приложения (workspace `apps/*`, появляется в D1);
- `tests/contracts/` — межъязыковые контракты с Pocket Editor и `baseline.json` с зафиксированными commit SHA исходных репозиториев;
- `scripts/` — вспомогательные скрипты (создание TypeScript fixtures через `tsx`);
- `docs/` — спецификации, планы и ADR.

## Скрипты

- `npm test` — запуск Vitest. По умолчанию выполняются `packages/**/*.test.ts` и `apps/**/*.test.ts`. При `GALLEY_CONTRACTS=1` дополнительно подключаются `tests/contracts/**/*.test.ts` (используется задачей контрактов C2). Playwright-спеки через Vitest не запускаются.
- `npm test -- packages/pocket-format/src` — быстрый прогон одного пакета (фильтр пути).
- `npm run typecheck` — `tsc -b --pretty false`: сборка проекта через project references, только декларации, артефакты в `dist/` (в git не попадают).

Зависимости ставятся через `npm install --save-exact`; lockfile (`package-lock.json`) коммитится. Требование к Node: `>=20` (уточняется выбранной версией Vite в D1).

## Границы пакетов

### `@galley-desk/pocket-format`

Формат sidecar-файлов Pocket Editor: кодек review и manifest, якоря и их разрешение, классификация записей, обнаружение глав.

- `documents.ts` — wire-типы (`Anchor`, `Edit`, `Signal`, `Review`, `Manifest`, `Range`, `Resolution`, `Availability`), кодек `decodeReview`/`encodeReview`/`decodeManifest`/`encodeManifest`. Схемы `packages/pocket-format/schemas/*.json` скопированы из Pocket Editor и валидируются Ajv2020 без coercion и `removeAdditional`; поверх схемы — реляционные проверки (уникальность ID, совпадение `chapter_id`/`source_path`, `after != before`, порядок строковых подсказок). Значения по умолчанию заполняются явно, как в Kotlin. Пересекающиеся диапазоны кодеком не отвергаются. Canonical JSON: фиксированный порядок полей, записи отсортированы по `id`, отступ в два пробела, один LF в конце; экранирование повторяет таблицу kotlinx.serialization.
- `anchors.ts` — `makeAnchor` (строгий UTF-8, границы по code point, контекст до 128 code points, SHA-256 через `node:crypto`) и `resolveAnchor` (семантика AnchorResolver: хеш выбранного фрагмента, сохранённый диапазон при совпадении хеша источника, поиск точных вхождений, затем контекст prefix/suffix).
- `availability.ts` — `classifyReview`: активные диапазоны правок и сигналов, недоступные записи (`stale`/`ambiguous`) и `conflicting` — все участники пересечения диапазонов правок исключаются из активных, но сохраняются. Сигналы могут пересекаться и не считаются конфликтующими.
- `discovery.ts` — `discover`: порядок и заголовки глав повторяют `BookDiscovery`/`ChapterTitleExtractor` (обычные `*.md` — только непосредственные дети без точки в начале; сначала главы с номером из front matter, затем естественное сравнение путей; известные пути манифеста и `ignored_files` не предлагаются; заголовок — из front matter, затем первый заголовок первого уровня через commonmark, затем имя файла).

Ни один пакет не импортирует Electron или React; пакет не предназначен для импорта из renderer-процесса (хеширование — Node crypto).

## Совместимость с Pocket Editor

- Оффсеты — точные UTF-8 байты; перевод строк исходника не нормализуется.
- Числа за пределами safe integer: файл открывается, но не перезаписывается (`encodeReview` отвергает такие оффсеты). В JSON BigInt не попадает.
- Схемы v1 не расширяются полями Galley Desk. Публикуемая схема ограничивает `prefix`/`suffix` через `maxLength` (UTF-16 единицы), а Pocket Editor считает code points, поэтому при валидации `maxLength` отключается в копии схемы и лимит 128 code points проверяется отдельно.
- `baseline.json` фиксирует реальные SHA исходных репозиториев (`git rev-parse HEAD`), а не плавающий `main`.
