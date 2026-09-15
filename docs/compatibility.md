# Совместимость с Pocket Editor

Galley Desk хранит правки в формате sidecar-файлов Pocket Editor (Kotlin/Android).
Кросс-язычные контракты проверяются двусторонне: TypeScript-кодек генерирует
`input.json`, реальный Kotlin-кодек (`ReviewJson`, `classifyReview`, `AnchorFactory`,
`BookDiscovery`) обрабатывает его в юнит-тесте `DesktopExchangeTest`, и результат
сверяется обратно TypeScript-тестами. Запуск: `npm run test:contracts`.

## Проверенные редакции

| Компонент | Версия/релиз | Проверенная редакция | Ветка |
| --- | --- | --- | --- |
| Pocket Editor | релиза tolerant-reviews ещё нет | `f3012aa8abb73cda32b943ff74f5b78039300d8f` | `galley-desk-tolerant-reviews` |
| Galley Editor | `@inkyquill/galley-editor` 0.14.0, `@inkyquill/galley-themes` 0.14.0 | `e5769b6b161af5275f7c2b490707aad5f3a5af09` | `feat/galley-themes-workspace` |
| Galley Pad | — | `16065357c6993b58d7e7262c41a8fac9e35729a9` | `main` |

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

## Статус

- Ревью с пересекающимися диапазонами и правки с повреждёнными якорями
  корректно принимает только Pocket Editor начиная с ветки
  `galley-desk-tolerant-reviews` (проверенная редакция `f3012aa`). Более старые
  версии могут отвергать такие sidecar-файлы.
- Как только tolerant-reviews работа выйдет в релиз Pocket Editor, номер релиза
  нужно подставить в таблицу выше вместо tested commit.
