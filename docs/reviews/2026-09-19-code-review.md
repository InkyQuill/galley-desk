# Ревью кода Galley Desk — 2026-09-19

**Вердикт: к приёмке не готово.** Архитектура выдержана (границы процессов, типизированный IPC,
журнал восстановления, «книга — источник истины»), статические проверки и 461 модульный тест
проходят. Но найдена одна **воспроизведённая потеря данных** в интерфейсе рецензии (R1), сломанный
пин кросс-язычных контрактов (R2), измеренная стоимость записи ~0,65 с на одно нажатие на
собственной перф-фикстуре проекта (R3) и неработающий перф-гейт (R5). Сигнал верификации,
на который опираются README и `docs/verification.md`, сейчас слабее, чем заявлено.

Шкала: **P1** — потеря/порча данных или тихая выдача неверного результата; **P2** — воспроизводимый
дефект, дефект гейта или измеренная деградация; **P3** — сопровождение, дрейф документации,
устойчивость тестов. Производственный код в ходе ревью не изменялся.

## Ревизии и границы проверки

| Что | Ревизия / версия | Состояние |
| --- | --- | --- |
| Galley Desk | `849b35d`, `main` | Рабочее дерево чистое; `node_modules` пересобран `npm ci` (860 пакетов) |
| Окружение | Linux, Wayland + Xwayland (`DISPLAY=:0`), Node 26.2.0, Electron 44.4.0, `devicePixelRatio` **1.15** | Собственная рамка, `shell.openPath`/`dialog` не подменялись |
| Pocket Editor (рядом) | `ad3f090`, `main` | Контракты прогнаны **против него** (см. R2) |
| Galley Editor (рядом) | `7110d6c` = `v0.15.0`; npm-пакеты `0.15.0` | Совпадает с `apps/desktop/package.json` |
| Galley Pad (рядом) | `fdc91c5` = `1.6.1` | Пин в `baseline.json` не существует (R2) |

Ревью покрывает 115 файлов `packages/*` и `apps/desktop` (≈26 тыс. строк с тестами) плюс CI, скрипты
и документацию. Читался код, а не только тесты; спорные утверждения проверялись запуском.

## Замечания к коду

### R1 · P1 — попап записи сохраняет состояние чужой записи и перезаписывает её

[RecordPopup.tsx:90](../../apps/desktop/src/renderer/review/RecordPopup.tsx#L90) заводит форму через
`useState` от пропа `record`, а [BookWindow.tsx:1201](../../apps/desktop/src/renderer/book/BookWindow.tsx#L1201)
рендерит попап **без `key`**. При выборе другой записи в панели рецензии `selectRecord`
([BookWindow.tsx:869](../../apps/desktop/src/renderer/book/BookWindow.tsx#L869)) синхронно делает
`setPopup(null)` и сразу `setPopup({kind:'record', id: next})` — React батчит оба обновления, слот
не меняется, компонент не перемонтируется, инициализаторы `useState` не выполняются заново. Форма
остаётся от предыдущей записи, а `record` уже новый.
[saveSignal](../../apps/desktop/src/renderer/review/RecordPopup.tsx#L173) подставляет новый `id` и
**старые** `comment`/`signalType`.

Воспроизведено (`evidence/code-review-2026-09-19/record-switch-probe.spec.ts`): две сигнальные
записи «ПЕРВЫЙ» (`note`) и «ВТОРОЙ» (`warning`); открыть попап первой, кликнуть вторую в списке,
нажать «Сохранить». Результат в sidecar:

```json
{"value":"ПЕРВЫЙ","warningPressed":"false",
 "savedSignals":[{"type":"note","comment":"ПЕРВЫЙ"},{"type":"note","comment":"ПЕРВЫЙ"}]}
```

То есть вторая запись потеряла и комментарий, и тип — молча и на диск. Существующие тесты
открывают попап только у одной записи, поэтому зелёный набор этого не показывает.

Направление исправления: `key={popup.id}` на попапе записи (карточка в панели уже перемонтируется
через `<li key={record.id}>`), либо производное состояние вместо `useState` от пропа; плюс
регрессионный сценарий из probe-файла.

### R2 · P2 — пин контрактов ссылается на несуществующие редакции; CI Contracts не может пройти

`tests/contracts/baseline.json` объявляет `pocket-editor.sha = f4aa28e2…`, `.github/workflows/contracts.yml:27`
выписывает `f3012aa8…` с комментарием «Keep in sync with tests/contracts/baseline.json».
[check-contracts.mjs](../../scripts/check-contracts.mjs) читает пин, сверяет его с `HEAD`
закреплённой копии и завершает проверку неуспешно при расхождении.

Проверено на клонах рядом:

| Пин | `git cat-file` / `git fetch origin <sha>` |
| --- | --- |
| pocket-editor `f4aa28e2c3f4035502ba4f51cd9b668a867b1527` | `not our ref` — объекта нет ни локально, ни на origin; не предок `main` |
| pocket-editor `002f609` (в `docs/compatibility.md` как «включает `002f609`») | не существует |
| galley-pad `dcc6bedb233e35493dc6d7c15ad280307fa1bef5` и `b78f22f` | не существуют |
| galley-editor `89a424fe…`, `0f538d7…` | существуют |

Последствия: (1) CI-задание Contracts детерминированно красное — оно выписывает `f3012aa8`, а
скрипт сравнивает `HEAD` с несуществующим `f4aa28e2`; (2) документированный рецепт
`git worktree add --detach .cache/contracts/pocket-editor f4aa28e2` (подсказка самого скрипта и
`docs/compatibility.md`) невыполним; (3) путь через `POCKET_EDITOR_DIR` пин **не проверяет** —
скрипт делает `assertPocketCheckout` (наличие `gradlew` и файла теста) и идёт дальше, поэтому
зелёный прогон через переменную не доказывает, что проверена закреплённая редакция.

Сам кодек при этом исправен: прогон против рабочей копии Pocket Editor (`ad3f090`) даёт
`[contracts] OK`, 21/21 тест обмена. Значит, сломан пин и гейт, а не совместимость.
[evidence/contracts.log](evidence/code-review-2026-09-19/contracts.log)

Направление: закрепить в `baseline.json` реально существующую редакцию (и синхронизировать с ней
`ref` в workflow), а для `POCKET_EDITOR_DIR` либо проверять ревизию, либо явно логировать, что
пин обойдён.

### R3 · P2 — классификация рецензии стоит O(записей × размер главы); путь подтверждения записи не бюджетирован

[anchors.ts:59](../../packages/pocket-format/src/anchors.ts#L59) считает `sha256(source)` для
**каждой** записи внутри `resolveAnchor`, а `classifyReview` вызывается на каждую пересборку модели
и на каждый снимок: [pieces.ts:44](../../packages/review-engine/src/pieces.ts#L44) (через `rebuild`),
[apply.ts:63](../../packages/review-engine/src/apply.ts#L63),
[book-service.ts:251](../../apps/desktop/src/main/book-service.ts#L251) (`buildRecordViews`).
Для главы 1 МиБ с 500 записями это ≈500 МиБ хеширования на один вызов.

Измерено на фикстуре самого проекта (1 МиБ, 250 правок + 250 сигналов; `evidence/…/engine-cost.log`):
`openChapter` 198 мс, `classifyReview` 204 мс, `changeText` 213 мс — **≈620 мс чистого CPU движка на
одну пачку набора**, не считая `writePair` (повторное чтение пары, ещё 4 прохода SHA-256 и обход
каталога журналов в `readJournalsForRoot`) и `checkExternal` перед командой.

Тот же порядок подтверждает встроенный замер: `inputToConfirmedSaveMs` на перф-прогоне —
медиана ≈655 мс, p95 902 мс (24 образца). При этом гейт проверяет только `openChapterMs ≤ 2000` и
`inputToRenderMs.p95 ≤ 50` — то есть **оптимистичный** путь рендера, который ввод не блокирует;
на `inputToConfirmedSaveMs` бюджета нет (`performance.spec.ts`), и в CI перф-прогон не запускается.
Пользователь при этом видит «Сохранено» примерно через секунду после каждой пачки, а main занят
этим CPU на каждое нажатие.

Направление: хеш источника считать один раз на `classifyReview` (или мемоизировать по идентичности
`Uint8Array`), `checkExternal`/`writePair` не должны пересчитывать одно и то же дважды, и стоит
ввести бюджет на путь подтверждения — иначе деградация остаётся невидимой для гейта.

### R4 · P2 — проверка `expectedRevision` в main не атомарна; FIFO живёт только в виде «Текст»

[book-service.ts:763](../../apps/desktop/src/main/book-service.ts#L763) проверяет ревизию, затем
`await entry.session.checkExternal()` (строка 779), повторно сверяет ревизию (строка 784) и только
потом применяет команду. `entry.revision` увеличивается **после** `applyCommand`, поэтому два
конкурентных `desk:command` с одинаковым `expectedRevision` проходят обе проверки и обе команды
применяются. Порядок обеспечивает только renderer: `CommandQueue` используется в «Тексте»
([ReviewEditor.tsx](../../apps/desktop/src/renderer/editor/ReviewEditor.tsx)), а `dispatchCommand`
в других видах уходит в `submit` напрямую ([BookWindow.tsx:719](../../apps/desktop/src/renderer/book/BookWindow.tsx#L719)).

Достижимый сценарий: в «Сравнении» открыть попап записи-сигнала и нажать «Отменить применение»
(кнопка в том же виде, [BookWindow.tsx:1107](../../apps/desktop/src/renderer/book/BookWindow.tsx#L1107)).
`Command.signal` несёт координаты `from`/`to` из снимка **до** отмены, а `addSignal` отображает их
на текущие `pieces` ([book-service.ts:565](../../apps/desktop/src/main/book-service.ts#L565)) —
сигнал получит anchor по чужим байтам и так и сохранится. Не воспроизводилось; окно видно из кода
конструкцией, а не по симптому. Направление: сериализовать команды главы в main (или поднимать
`entry.revision` в момент принятия команды, до `await`), и не полагаться на FIFO во вью.

### R5 · P2 — перф-гейт не запускается вообще

`GALLEY_PERF=1 npx playwright test tests/desktop/performance.spec.ts --workers=1` (команда из
README и `AGENTS.md`) падает на первой же проверке: `getByRole('button', { name: 'Глава 050' })`
матчит две кнопки — главу и `aria-label="Действия главы: Глава 050"`
([ChapterSidebar.tsx](../../apps/desktop/src/renderer/book/ChapterSidebar.tsx), введено в `014f868`).
Playwright strict mode превращает это в ошибку до всех замеров. Тест помечен
`test.skip(GALLEY_PERF !== '1')`, CI его не запускает (`desktop.yml` лишь упоминает ручную команду) —
поэтому поломка не видна в общем прогоне. С исправленным локатором (`exact: true`, только локатор)
прогон проходит за 22 с, то есть сам сценарий жив; сломан именно доступ к нему.
[evidence/perf-gate-broken.log](evidence/code-review-2026-09-19/perf-gate-broken.log),
[evidence/perf-gate-fixed.log](evidence/code-review-2026-09-19/perf-gate-fixed.log)

Направление: починить локатор (`{ exact: true }` в трёх местах), добавить бюджет на
`inputToConfirmedSaveMs` (R3) и решить, должен ли перф-прогон быть обязательным хотя бы на одном
runner'е.

### R6 · P3 — черновик пишется, но из продукта недостижим; файлы копятся без очистки

`readDrafts` ([session.ts:100](../../packages/book-storage/src/session.ts#L100)) экспортируется, но
используется только тестами: единственный продуктовый путь к черновику — `exportDraft` в состоянии
`external` ([book-service.ts:860](../../apps/desktop/src/main/book-service.ts#L860)). После
перезапуска приложения `createChapterEntry` открывает сессию поверх диска и черновик не читает,
поэтому сохранённая копия остаётся только «файлом в appData», который нигде не перечислен; число
`*.draft.json` не ограничено и ничем не удаляется. Envelope черновика несёт только `chapter_id`
([session.ts:77](../../packages/book-storage/src/session.ts#L77)) — без `book_id`/корня черновик
не атрибутируется книге. Аккуратно с формулировкой: спецификация обещает локальную копию, а не
восстановление в UI, и путь ошибки закрытия книги намеренно блокирует выход, так что это скорее
пробел в восстановлении после аварийного завершения, чем обещание, которое ломается.

### R7 · P3 — «проверенные редакции» в документации расходятся с кодом

Актуальный раздел `docs/compatibility.md:12` верен (`0.15.0`), но тут же (строки 30–43) таблица
исторического среза утверждает в настоящем времени «Pad использует editor `0.13.0` и themes
`0.14.0`; **Desk — оба `0.14.0`**» и перечисляет несуществующие пины, тогда как
`apps/desktop/package.json` пинует `@inkyquill/galley-editor`/`galley-themes` `0.15.0`
(в `node_modules` установлены `0.15.0`). Оговорка «исторический срез» в разделе есть, но
present-tense-утверждение о Desk читается как текущее состояние и теперь неверно. Направление:
пометить строки про Desk как снимок на дату отчёта (или обновить), а пины привести к
существующим редакциям — это часть R2.

### R8 · P3 — часть Electron-тестов привязана к окружению

На этом хосте (`devicePixelRatio` 1.15) четыре проверки падают на точном сравнении CSS-пикселей:
`336px` против `335.992px`, `363px`/`362.989px`, `347px`/`346.997px`, `352px`/`351.997px`
(`review-actions.spec.ts:706`, `sidebar-layout.spec.ts:73/121/152`). Это округление layout до
физических пикселей, а не дефект поведения, — но протокол проекта прямо включает проверку на
масштабе 125 %, где те же строки упадут. Три теста `window-frame.spec.ts` требуют X11
(`xdotool search --onlyvisible`, `xprop`): под нативным Wayland-окном `xdotool` не находит окно, и
это тоже окружение. Направление: сравнивать числа с допуском (или `toBeCloseTo` на распарсенном
значении) и явно документировать требование X11/WM для оконных тестов.
[evidence/display-scale.log](evidence/code-review-2026-09-19/display-scale.log)

### R9 · P3 — мелкое

- [history.ts:32](../../packages/review-engine/src/history.ts#L32): запись redo сохраняет
  `before: current` вместо `entry.before`, то есть поле заведомо неверно; сегодня безвредно
  (читается только `after`), но это ловушка для следующего читателя.
- [apply.ts:52](../../packages/review-engine/src/apply.ts#L52): ветка `old.from === old.to` в
  `replaceSourceRange` недостижима — `validateAnchor` требует непустой диапазон.
- [apply.ts:63](../../packages/review-engine/src/apply.ts#L63): `): ChapterModel {  const availability`
  — потерян перевод строки (единственный такой случай в файле).
- [MetadataPopover.tsx:40](../../apps/desktop/src/renderer/book/MetadataPopover.tsx#L40):
  два `useEffect` без массива зависимостей вешают и снимают документные слушатели на каждом
  рендере.
- `book-service.ts`: `loadRecentBooks` + `saveRecentBooks` (read-modify-write) не проходят через
  очередь, в отличие от `settings`; при конкурентных обновлениях возможна потеря записи
  «недавних» (не влияет на файлы книги).

## Свежие проверки

Все команды — с пересобранными после `npm ci` зависимостями, из корня репозитория.

| Проверка | Фактический результат |
| --- | --- |
| `npm ci` | PASS, 860 пакетов |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 461 тест, 36 файлов |
| `npm run test:contracts` (без `POCKET_EDITOR_DIR`) | FAIL по замыслу: «no Pocket Editor sources found», ссылка на несуществующий `f4aa28e2` |
| `POCKET_EDITOR_DIR=../pocket-editor npm run test:contracts` (`ad3f090`) | PASS: 21 тест обмена, `[contracts] OK` — но пин `baseline.json` не проверялся |
| `npm run check:security` | Завершился: 36 atomic / 6 global, 6 находок, 0 ошибок разбора (2 из них — известные ложные по `buildMainWindowOptions`, см. `security.md`) |
| `npm run package` | PASS, `out/galley-desk-linux-x64/galley-desk` создан |
| `npx playwright test --workers=1` | 96 passed, **7 failed**, 5 skipped (2,7 мин). Из семи: 3 — X11/`xdotool`, 4 — точные px при DPR 1.15 (R8) |
| `GALLEY_PERF=1 … performance.spec.ts` | FAIL на strict-mode violation локатора (R5) |
| То же с исправленным локатором | PASS за 22 с: `openChapterMs` 840 ≤ 2000, `inputToRenderMs.p95` 26,9 ≤ 50, **`inputToConfirmedSaveMs` p95 902 / медиана ≈655** (бюджета нет — R3) |
| Микробенчмарк движка (1 МиБ, 500 записей) | `classifyReview` 204 мс, `changeText` 213 мс, ≈620 мс на команду |
| Пробник попутного состояния попапа | Воспроизводит порчу второй сигнальной записи (R1) |

Числа производительности — этого хоста (Wayland, DPR 1.15, Node 26.2.0) и с ними нельзя сравнивать
исторические бюджеты `docs/verification.md`; важны порядок величины и отсутствие проверки на этом
пути. `performance-results-host2026-09-19.json` содержит полный набор образцов.

## Не проверено

- macOS: сборка, сочетания клавиш, трейфик-лайты, IME — ни разу не запускалось здесь.
- Реальная передача папки Desk → Pocket → Desk и Android instrumentation (нет устройства).
- Ручной прогон на реальной книге: 100 глав генерировались синтетически, «человеческие» книги
  не открывались.
- Масштаб 125 %/1920 px, светлая и тёмная схемы вживую (скриншоты не снимались).
- Сценарий R4 (конкурентные команды в «Сравнении») — оценён по коду, не воспроизведён.
- Electronegativity: находки не разбирались повторно, `security.md` принят как есть.

## Приложения

`docs/reviews/evidence/code-review-2026-09-19/`: `record-switch-probe.spec.ts` + `.log` (R1),
`contracts.log` (R2), `engine-cost.log`, `performance-results-host2026-09-19.json` (R3),
`perf-gate-broken.log`, `perf-gate-fixed.log` (R5), `desktop-suite.log`, `display-scale.log` (R8),
`bench-classifyCommand.ts` (воспроизведение микробенчмарка).

Файл `AGENTS.md` в корне появился во время этого ревью не от автора ревью и оставлен как есть.
