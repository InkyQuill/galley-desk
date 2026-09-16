# Совместимость с Pocket Editor

Galley Desk хранит правки в формате sidecar-файлов Pocket Editor (Kotlin/Android).
Кросс-язычные контракты проверяются двусторонне: TypeScript-кодек генерирует
`input.json`, реальный Kotlin-кодек (`ReviewJson`, `classifyReview`, `AnchorFactory`,
`BookDiscovery`) обрабатывает его в юнит-тесте `DesktopExchangeTest`, и результат
сверяется обратно TypeScript-тестами. Запуск: `npm run test:contracts`.

## Проверенные редакции

> Аудит 2026-09-16: таблица ниже отражает прежний baseline. Миграция Galley Pad фактически находится в `feat/shared-themes`, commit `6f8cfff5175e423d19458571fc71c42b791f30b1`; её unit и theme integration прошли, общий gate ещё красный. `1606535/main` не содержит миграцию. Подробности и результаты всех проектов — в [аудите](reviews/2026-09-16-implementation-audit.md). Baseline следует обновить на итоговые проверенные редакции при A6.

| Компонент | Версия/релиз | Проверенная редакция | Ветка |
| --- | --- | --- | --- |
| Galley Desk | `apps/desktop` 0.1.0 | этот репозиторий, ветка `main` (редакция фиксируется тегом выпуска; сборка и тесты — см. `docs/verification.md`) | `main` |
| Pocket Editor | релиза tolerant-reviews ещё нет | `f3012aa8abb73cda32b943ff74f5b78039300d8f` | `galley-desk-tolerant-reviews` |
| Galley Editor | `@inkyquill/galley-editor` 0.14.0, `@inkyquill/galley-themes` 0.14.0 | `e5769b6b161af5275f7c2b490707aad5f3a5af09` | `feat/galley-themes-workspace` |
| Galley Pad | — | `16065357c6993b58d7e7262c41a8fac9e35729a9` | `main` |

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
- Как только tolerant-reviews работа выйдет в релиз Pocket Editor, номер релиза
  нужно подставить в таблицу выше вместо tested commit.
