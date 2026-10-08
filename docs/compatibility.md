# Совместимость с Pocket Editor

Galley Desk хранит правки в формате sidecar-файлов Pocket Editor (Kotlin/Android).
Кросс-язычные контракты проверяются двусторонне: TypeScript-кодек генерирует
`input.json`, реальный Kotlin-кодек (`ReviewJson`, `classifyReview`, `AnchorFactory`,
`BookDiscovery`) обрабатывает его в юнит-тесте `DesktopExchangeTest`, и результат
сверяется обратно TypeScript-тестами. Запуск: `npm run test:contracts`.

## Текущие зависимости Desk

Desk использует опубликованные npm-пакеты `@inkyquill/galley-editor` и
`@inkyquill/galley-themes` версии `0.17.0`, закреплённые точными версиями
и integrity в lockfile. Registry `gitHead` редактора:
`ff6a3163faa0f2ba9eb4255d66d40f51c4275be9`; эта редакция закреплена в baseline.
Обновление 2026-10-08 не меняет схемы Pocket. Проверки текущей версии
описаны в [протоколе проверки](verification.md).
Таблица ниже — сохранённый исторический срез, а не текущие package pins.

## Проверенные редакции A6/A7 (исторический срез)

Проверки A6 и A7 выполнены 2026-09-16 в изолированных feature-worktrees.
Затем изменения слиты в локальные main и повторно проверены; таблица ниже
указывает редакции после слияния. Исходные результаты A6/A7 сохранены в отчётах.
Проверенная исходная редакция и опубликованный npm-артефакт — отдельные
объекты проверки; номера npm-пакетов не присваиваются source-коммитам.

| Компонент | Версия/релиз | Проверенная редакция | Ветка |
| --- | --- | --- | --- |
| Galley Desk | `apps/desktop` 0.1.0 | локальная main; итоговые проверки — `docs/verification.md` | `main` |
| Pocket Editor | source с filename compatibility fix; пока не опубликован | `f4aa28e2c3f4035502ba4f51cd9b668a867b1527` (включает `002f609`) | `main` |
| Galley Editor / themes, исходники | package.json обоих пакетов `0.14.0` | `89a424fea51a026c9fcc5d8d45ea7390d96fc2a1` (включает `4da44fc`, сохраняет релиз `0f538d7`) | `main` |
| Galley Editor / themes, npm | оба пакета `0.14.0` | отдельные registry tarballs; npm `gitHead` обоих: `0f538d72e7e6ee53b1e6e237eec0b6a237610735` | опубликованные артефакты, не source pin |
| Galley Pad | package.json `1.6.1`; релизная версия сохранена | `dcc6bedb233e35493dc6d7c15ad280307fa1bef5` (включает `b78f22f`) | `main` |

Editor: 526 unit + 11 themes, lint, настоящий package-consumer, docs и
Storybook прошли. Отдельный consumer-прогон опубликованных tarballs `0.14.0`
проверил runtime exports, CSS subpath и TypeScript types без mock Galley.
Pad: полный `mise run verify` прошёл (audit, 275 unit, 20 scripts,
19 browser integration, build, Rust fmt/40 tests, Tauri info/debug build).
Pad использует editor `0.13.0` и themes `0.14.0`; Desk — оба `0.14.0`.

Статус после локального слияния: исправления Desk, Pocket, Editor и Pad
включены в соответствующие `main`. Push и публикация не выполнялись.
Релизные версии Editor/themes `0.14.0`, Pad `1.6.1` и Pocket `0.6.0`
сохранены; новые исправления не считаются опубликованными только из-за
совпадения номера package.json. Публичный Pocket v0.6.0 не содержит
filename compatibility fix; бинарный артефакт этого релиза в A6/A7 не проверялся.
Исходные feature-пины и исторические статусы сохранены в отчётах A6/A7.

Desktop → Pocket → Desktop folder roundtrip **PASS**: неизменённый canonical
fixture открыт production ReaderRepository на Android 15/API35; SaveNote
сохранил edits/signals, UUIDs, порядок, anchors и точные source/manifest bytes.
Экспорт открыт настоящим packaged Desk: active/conflicting/unavailable записи
видны, Apply→Undo возвращает полную пару побайтово. Отдельный legacy filename
вариант также открыт настоящим Desk. Команды/ограничения: [A7 compatibility
report](reviews/2026-09-16-evidence/a7-compat/report.md).

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
- Pocket `v0.6.0` содержит tolerant-reviews; текущий baseline дополнительно
  фиксирует неопубликованный canonical/legacy filename fix, проверенный в A7.

## Имена sidecar и конфликт двух файлов

Оба приложения читают `<stem>.review.json` и существующий
`<chapter.md>.review.json`. Единственное существующее имя сохраняется при
записи; новый sidecar получает canonical имя `<stem>.review.json`. Pocket
сохраняет это же имя в outbox, remote revision, merge base и pending deletion.
Никакого автоматического переименования нет. Если одновременно существуют оба
имени (включая local/remote сочетание) либо имя неоднозначно для manifest,
операция блокируется с явной ошибкой, оба файла сохраняются. Даже одинаковые
по содержимому дубликаты не объединяются автоматически. Wire-схема не меняется.
