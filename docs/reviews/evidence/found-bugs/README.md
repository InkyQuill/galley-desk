# Интеграционная приёмка партии исправлений found-bugs (баги 1–10)

Ветка `found-bugs-fixes`, HEAD `01f4fc6` (диапазон `275c526..01f4fc6`, задачи T1–T8).
Дата приёмки: 2026-09-19. Все оконные команды запущены через канонический
изолятор `scripts/gui-test.sh <cmd>` (свой Xvfb + Openbox на каждый запуск,
`XAUTHORITY`/`WAYLAND_DISPLAY`/`XDG_SESSION_TYPE` сняты,
`ELECTRON_OZONE_PLATFORM_HINT=x11` закреплён, `--workers=1`); globalSetup-guard
воспретил бы любой запуск вне виртуального дисплея.

## Хост

- OS: Linux x86_64, CachyOS, ядро `7.2.3-1-cachyos`
- Node v26.2.0, npm 11.13.0
- Xvfb `xorg-server-xvfb 21.1.24-1.1`, Openbox `3.6.1-14.2`
- Платформа проверки — только Linux/X11 (виртуальный дисплей).
  **macOS: NOT RUN по всем пунктам** (недоступна на этой машине; проверка
  не выполнялась и не засчитывается). Масштаб 125% проверен там, где
  реально верифицирован: `webContents.setZoomFactor(1.25)` на 1280 px,
  обе темы — кадры `*-1280-*-zoom125.png`; остальная матрица снята при 100%.

## Шаг 1. Статические проверки

| Команда | Результат |
|---|---|
| `npm run typecheck` | PASS (лог `typecheck.log`) |
| `npm test` (vitest) | PASS: 37 файлов, 479/479 (`unit.log`) |
| `npm run test:contracts` | **NOT RUN** — пиннутый чекаут Pocket Editor недоступен: `.cache/contracts/pocket-editor` в worktree и в основном репозитории отсутствует; сиблинг `../pocket-editor` на `ad3f0909`, не содержит пиннутый объект `f4aa28e2c3f4035502ba4f51cd9b668a867b1527`, и пин недостижим ни из одной remote-ссылки (`git ls-remote origin | grep f4aa28e2` — пусто). Подставлять не-пиннутый чекаут запрещено политикой (`AGENTS.md`), поэтому проверка честно не выполнена |
| `npm run check:security` | PASS, exit 0; 6 известных находок (CSP low, open-external/auxclick/contextIsolation/sandbox medium-high) — разбор в `security.md`, без новых относительно базовых (`security.log`) |

`git diff --check` — чисто.

## Шаг 2. Затронутые Electron-наборы одной командой

```
./scripts/gui-test.sh npx playwright test \
  tests/desktop/diagnostics.spec.ts tests/desktop/review-actions.spec.ts \
  tests/desktop/sidebar-layout.spec.ts tests/desktop/workspace-layers.spec.ts \
  tests/desktop/window-frame.spec.ts tests/desktop/search-and-appearance.spec.ts \
  tests/desktop/open-book.spec.ts tests/desktop/notifications.spec.ts --workers=1
```

Результат: **78 passed / 0 failed** (1.3m), exit 0 (`affected-suites.log`).

### Известные сбои базовой линии (хостовые, задокументированы заранее)

Контролёр верифицировал их на исходной базе `275c526` в отдельном worktree:

- 4 суб-пиксельных проверки ширины: 1× `review-actions.spec.ts` «dense-review»
  (335.992 против 336), 3× `sidebar-layout.spec.ts` (362.989/346.997/351.997).
- `book-management.spec.ts`: 3–4 сбоя (один флакующий) — предварительно
  существующие хостовые проблемы, НЕ регрессии ветки (набор не входит в
  затронутые и в прогон шага 2 не включался).

На текущей ветке прогон шага 2 зелёный полностью. Механизм (проверен по diff
`275c526..01f4fc6`): строгие проверки ширины остались в силе дословно —
`sidebar-layout.spec.ts:73,121,242` (`toHaveCSS('width', '363px'/'347px'/'352px')`)
и `review-actions.spec.ts:792-799` (точная ширина 336 px в «dense-review») не
менялись; фичи T4/T5 (`956e8dd`, `2d71724`) изменили геометрию раскладки, так
что эти неизменные строгие проверки теперь вычисляются в точные значения.
Проверки `toBeCloseTo(32, 0)` и `toBeCloseTo(bodyWidth, 0)` — новые добавления
к новым фичам, а не замены: `git show 956e8dd` удаляет только проверки
видимости «Было/Стало»/«удаление», `git show 2d71724` — только клики/фокус
старых тулбарных переключателей. Ни одна проверка ширины не была ослаблена
или удалена; «зелёный» здесь сильнее, чем получилось бы переписыванием
проверок. Списки книг не трогались.

## Шаг 3. Временная копия реальной книги

Источник: реальная книга пользователя `~/Yandex.Disk/writing/aria`
(манифест Pocket Editor, 53 главы, ~1.1 МБ, реальный роман). Копия:
`/tmp/galley-found-bugs-scenario/aria-copy` (`cp -a`), изолированный профиль
`GALLEY_DESK_USER_DATA`. Сценарий (`real-book-scenario.log`) через настоящий
UI создал **22 записи (18 правок + 4 сигнала)**: на одной строке главы 1 —
три маркера (замена «Грузовик»→«Фургон», удаление, вставка «позже»); замены,
удаления и сигналы в главах 1–3; hover и scroll-away/return панели выделения;
навигация к удалению; поиск; open-folder; искусственно вызванные рабочие
ошибки (chmod 0o555 + отказ `desk:set-layout`) с последующим разрешением по
действиям карточек, включая отложенное восстановление («Открыть внешнюю
версию» — журнал в app data).

### SHA-256 до/после (`real-book-sha-before.txt` / `-after.txt`, сводка `real-book-sha-summary.txt`)

- Исходная книга: **54 файла, до == после** — не тронута вообще.
- Копия: добавлены только `chapter-001-v2.review.json`, `chapter-002-v2.review.json`,
  `chapter-003-v2.review.json` (созданные сценарием записи); **ни один из
  54 прежних файлов не изменён и не удалён**, каждый байт совпадает с
  исходником. Канонический Markdown не переписан — правки живут в sidecar
  до явного «Применить».

## Шаг 4. Кадры (света/тьма × 900/1280/1920; 125% где верифицировано)

Каталог `shots/` — 46 PNG, каждый просмотрен вручную; 4 кадра пересняты
(истинный свет на zoom125, кадрирование 1280-dark стека).

| Субъект | Кадры |
|---|---|
| Titlebar: имя книги, путь, статус сохранения, open-folder | `titlebar-{900,1280,1920}-{light,dark}.png` |
| Поиск: отступы/зазоры панели, счётчик, подсветка | `search-{900,1280,1920}-{light,dark}.png` |
| Компактные строки рецензии (+/−/карандаш, без «Было/Стало») | `review-rows-{900,1280,1920}-{light,dark}.png` |
| Свёрнутые сайдбары: плавающие триггеры по краям | `triggers-{900,1280,1920}-{light,dark}.png` |
| Стакан маркеров одной строки: покой / hover поверх текста | `stack-rest-*`, `stack-hover-*` (12 + 2 zoom125) |
| Нижний центр уведомлений с действиями (стек карточек) | `notice-{900,1280,1920}-{light,dark}.png` + `notice-1280-{light,dark}-zoom125.png` |

Примечание: на 1280/900 часть маркеров одной исходной строки переносится на
другую визуальную строку — стакан честно разделяется по строкам; полный
стек из трёх маркеров виден на 1920 и на hover-кадрах 1280. Три кадра
`stack-rest-1920-light.png`, `stack-rest-1280-light.png` и
`stack-rest-1920-dark.png` байт-в-байт совпадают с одноимёнными `notice-*`
кадрами: в этот момент кадра легитимно видны оба субъекта сразу (стакан
маркеров по центру и стек уведомлений снизу).

## Шаг 5. Сборка и packaged smoke

`npm run package` — exit 0 (`package.log`), выход
`apps/desktop/out/galley-desk-linux-x64/galley-desk`. На собранном бинарнике
(`GALLEY_PACKAGED_EXECUTABLE`, CDP-only, тот же wrapper):
**7/7 PASS** (`packaged-smoke.log`) — открытие копии из недавних, responsive
sidebar (900 px: свёртывание → плавающий триггер → сфокусированный overlay →
Escape), навигация к удалению с placeholder в viewport, крестик диагностики,
open book folder (main-owned openPath: ни ошибки, ни уведомления, окно
интерактивно).

## Шаг 6. Self-review по пунктам 1–10

| № | Баг | Задача | Evidence (тест/кадр) | Вердикт |
|---|---|---|---:|---|
| 1 | «Было/Стало», line-height | T4 | `review-actions.spec.ts` «виды правок…», «стек маркеров…»; `review-rows-*.png` (2 строки на запись, иконки, без слов «Было/Стало») | PASS |
| 2 | Крестик диагностики | T1 | `diagnostics.spec.ts` «крестик … closes it with a real pointer click»; packaged smoke; сценарий шага 3 | PASS |
| 3 | Переключатели сайдбаров | T5 | `sidebar-layout.spec.ts` «panel toggles live in the panel headings…»; `triggers-*.png` (toggle в заголовке, плавающие триггеры, overlay) | PASS |
| 4 | Название/путь/open folder | T6 | `window-frame.spec.ts` (44px titlebar, `.titlebar__title/path`); `titlebar-*.png`; IPC `desk:open-book-folder` принимает только opaque `bookId`, main сам резолвит путь и зовёт `shell.openPath` (unit-тесты trusted/foreign); packaged smoke | PASS |
| 5 | Hover и scroll панели выделения | T2 | `review-actions.spec.ts` «flyout привязан к живой геометрии…»; сценарий шага 3 (скрылась при прокрутке, вернулась к тому же выделению, top = bottom+6) | PASS |
| 6 | Навигация к удалению | T3 | `review-actions.spec.ts` «переход к удалению из панели…» + «на пустой строке…»; packaged smoke; сценарий шага 3 (placeholder в viewport, текст не гаснет) | PASS |
| 7 | Несколько gutter-иконок | T4 | `review-actions.spec.ts` «стек маркеров одной строки…» (gutter 32px неизменен, hover разворачивает поверх текста); `stack-rest/hover-*.png` | PASS |
| 8 | Отступы поиска | T7 | `search-and-appearance.spec.ts` «геометрия строки поиска… (900 и 1280 px)»; `search-*.png` | PASS |
| 9 | Иконки insertion/deletion | T4 | `review-actions.spec.ts` «виды правок…» (pencil/minus/plus, только существующие before/after-строки, aria-label сохранён); `review-rows-*.png`, `stack-*.png` | PASS |
| 10 | Нестилизованные ошибки над редактором | T8 | `notifications.spec.ts` (5 тестов: плавающая карточка без reflow, стек 8px + dismiss/retry, локальные ошибки форм не дублируются центром, на 900px карточка не перекрывает триггеры, темы/зум/readonly); `notice-*.png` (+zoom125); сценарий шага 3 (3 карточки, действиями разрешены) | PASS |

Cross-проверки self-review:

- **Нет новых IPC с произвольным path**: единственный новый канал —
  `desk:open-book-folder(bookId)` с непрозрачным id; путь резолвится в main
  через реестр открытых книг (`git diff` main/preload просмотрен).
- **Схема sidecar не менялась**: `packages/pocket-format` — ноль изменений в
  диапазоне; форматы Pocket не тронуты.
- **Reflow ширины чтения отсутствует**: `lineWidth`/ширина колонки чтения не
  менялись; уведомления живут вне потока (тесты геометрии `.book__body`/
  `.cm-scroller` зелёные).
- **Дублирующих alert нет**: один логический сбой = одна карточка = один
  `role="alert"` (инфо — `role="status"`), тесты на пересечения зелёные.
- **Клавиатурные пути не потеряны**: Escape-цепочки, Tab во flyout, возврат
  фокуса к триггерам, клавиатурный коммит ширины, Escape в поиске — все
  соответствующие тесты в прогоне 78/78.

## Ограничения

- macOS — NOT RUN (см. выше); 125% — только 1280 px, обе темы.
- `test:contracts` — NOT RUN по причине отсутствия пиннутого чекаута.
- Кадр `review-rows-*-1280/1920-*.png` содержит тематический тултип «Поиск по
  главе Ctrl+F» у кнопки поиска (след Escape-фокуса предыдущего шага) —
  сам тултип корректен, на доказательство строк рецензии не влияет.
