# Совместимость с Pocket Editor

Galley Desk хранит правки в формате sidecar-файлов Pocket Editor (Kotlin/Android).
Кросс-язычные контракты проверяются двусторонне: TypeScript-кодек генерирует
`input.json`, реальный Kotlin-кодек (`ReviewJson`, `classifyReview`, `AnchorFactory`,
`BookDiscovery`) обрабатывает его в юнит-тесте `DesktopExchangeTest`, и результат
сверяется обратно TypeScript-тестами. Запуск: `npm run test:contracts`.

## Проверенные редакции

Проверка A6 выполнена 2026-09-16 в изолированных feature-worktrees.
Проверенная исходная редакция и опубликованный npm-артефакт — отдельные
объекты проверки; номера npm-пакетов не присваиваются source-коммитам.

| Компонент | Версия/релиз | Проверенная редакция | Ветка |
| --- | --- | --- | --- |
| Galley Desk | `apps/desktop` 0.1.0 | текущая приёмочная ветка; итоговые проверки — `docs/verification.md` | `codex/v0.1-acceptance` |
| Pocket Editor | `f3012aa` входит в опубликованный `v0.6.0`; тесты выполнены на source pin | `f3012aa8abb73cda32b943ff74f5b78039300d8f` | `galley-desk-tolerant-reviews` |
| Galley Editor / themes, исходники | package.json обоих пакетов `0.13.0` | `4da44fcc1290381a8c9bbfdffcdb349dd68494cf` (база `e5769b6b161af5275f7c2b490707aad5f3a5af09`) | `feat/galley-themes-workspace` |
| Galley Editor / themes, npm | оба пакета `0.14.0` | отдельные registry tarballs; npm `gitHead` обоих: `0f538d72e7e6ee53b1e6e237eec0b6a237610735` | опубликованные артефакты, не source pin |
| Galley Pad | package.json `1.6.0`; миграция проверена в feature-ветке | `b78f22f27f00a98479369c6a18170e5d12aeb5c1` (база `6f8cfff5175e423d19458571fc71c42b791f30b1`) | `feat/shared-themes` |

Editor: 526 unit + 11 themes, lint, настоящий package-consumer, docs и
Storybook прошли. Отдельный consumer-прогон опубликованных tarballs `0.14.0`
проверил runtime exports, CSS subpath и TypeScript types без mock Galley.
Pad: полный `mise run verify` прошёл (audit, 275 unit, 20 scripts,
19 browser integration, build, Rust fmt/40 tests, Tauri info/debug build).
Pad использует editor `0.13.0` и themes `0.14.0`; Desk — оба `0.14.0`.

Статус merge/release на момент проверки: локальные main Editor и Pad не
содержат проверенные feature-коммиты; новые исправления A6 не слиты и не
опубликованы. Наличие npm `0.14.0` не доказывает публикацию этих исправлений.
Pocket pin уже входит в локальный main и tag `v0.6.0`; GitHub подтверждает
[публичный релиз v0.6.0](https://github.com/InkyQuill/pocket-editor/releases/tag/v0.6.0)
от 2026-09-15. Бинарный артефакт релиза Pocket в A6 не проверялся.
В этом workflow merge/push/publish не выполнялись.

Сквозная проверка передачи папки (Desktop → Pocket Editor → Desktop) на
эмуляторе Android на этой машине не выполнялась — процедура и статус:
`docs/verification.md`. Контрактная совместимость кодеков при этом
проверяется автоматически (`npm run test:contracts`) на редакции
Pocket Editor из таблицы выше.

Актуальные пины живут в `tests/contracts/baseline.json`; скрипт контрактов
использует их при развёртывании изолированной копии Pocket Editor
(`.cache/contracts/pocket-editor`, переопределяется переменной `POCKET_EDITOR_DIR`).

## Что именно проверяется

- **Ревью.** Kotlin-канонизация ревью (включая `chapter_note`, `comment`,
  порядок записей) сохраняет все поля; `decodeReview`/`encodeReview` в TypeScript
  воспроизводят канонический вид побайтово, смещения — в байтах UTF-8.
- **Классификация.** Списки `activeEditIds` / `conflictingEditIds` /
  `unavailableIds` совпадают с TypeScript-реализацией `classifyReview`.
- **Якоря.** `AnchorFactory.create` и `makeAnchor` дают одинаковые якоря
  (SHA-256 источника и выделения, строки, контекст по 128 кодпоинтов);
  сгенерированные Kotlin якоря разрешаются TypeScript-резолвером.
- **Обнаружение глав.** Порядок глав из `BookDiscovery.propose` (числовые
  префиксы, front matter, скрытые и вложенные файлы) совпадает с `discover()`.
- **Повреждённый якорь.** Правка с испорченным `selection_sha256` у обоих
  резолверов возвращается как `stale`, и кодек не теряет запись.

## Манифесты v2

Pocket Editor начиная с ветки `galley-desk-tolerant-reviews` (проверенная
редакция `f3012aa`) пишет манифесты `schema_version: 2` — главы без поля
`title`. Galley Desk читает такие манифесты толерантно и проецирует их в свою
модель: главы берутся из wire в исходном порядке (id и path), заголовки глав
в прочитанной модели остаются пустыми, интерфейс показывает путь главы,
неизвестные поля v2 игнорируются. Файл манифеста при открытии никогда не
перезаписывается, поэтому конвертация версий через Galley Desk невозможна;
новые манифесты Galley Desk создаёт по-прежнему как v1. Структурно
невалидный v2-манифест (плохой UUID, дубликаты id/path) и неизвестная версия
`schema_version` остаются read-only ошибкой открытия (`ManifestError`).

## Статус

- Ревью с пересекающимися диапазонами и правки с повреждёнными якорями
  корректно принимает только Pocket Editor начиная с ветки
  `galley-desk-tolerant-reviews` (проверенная редакция `f3012aa`). Более старые
  версии могут отвергать такие sidecar-файлы.
- Pocket `v0.6.0` содержит tolerant-reviews; source pin сохранён в baseline,
  поскольку именно на нём выполнялись контрактные тесты.
