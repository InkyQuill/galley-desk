# Found Bugs Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить десять замечаний из тестирования Galley Desk, включая единый нижний слой рабочих ошибок, сохранив безопасность Electron, доступность, состояние рукописи и существующие responsive/Zen-сценарии.

**Architecture:** Работа делится на четыре независимых слоя: безопасный chrome/IPC, компоновка панелей, геометрия редактора и представление рецензии. Сначала каждый дефект фиксируется узким RED-тестом, затем меняется минимальный владелец поведения; общий финальный прогон проверяет их взаимодействие на настоящем Electron-окне.

**Tech Stack:** TypeScript 5.9, React 19, Electron 44, CodeMirror 6 через `@inkyquill/galley-editor`, Tabler Icons, Vitest, Playwright Electron.

**Spec:** пользовательский внешний отчёт «Баги.md»; дополнение пользователя от 2026-09-19 о плавающих ошибках; связанный базовый UX-контракт: `docs/superpowers/specs/2026-09-17-diagnostics-and-workspace-ux.md`.

## Global Constraints

- Не менять Pocket schema, формат sidecar, модель правок или содержимое пользовательских книг.
- Не добавлять зависимости: использовать существующие React, CodeMirror, Tabler Icons и theme tokens.
- Все действия остаются доступны клавиатурой; иконки получают стабильные accessible names и themed Tooltip.
- Путь книги открывает только main process по уже открытому `bookId`; renderer не передаёт произвольный filesystem path в `shell.openPath`.
- Сохранить flush/conflict/recovery, Undo/Redo, IME, frontmatter protection, responsive overlay и Zen.
- Поддержать Linux и macOS; проверить light/dark, 900/1280/1920 px и 125% scale там, где окружение доступно.
- Не обновлять установленное приложение в рамках этого плана.

## Карта изменений

- `apps/desktop/src/renderer/diagnostics/Diagnostics.tsx`, `app.css` — кликабельное закрытие native dialog.
- `apps/desktop/src/renderer/review/SignalFlyout.tsx`, `renderer/editor/ReviewEditor.tsx` — hover и геометрия панели выделения при скролле.
- `apps/desktop/src/renderer/editor/visual-range.ts`, `ReviewEditor.tsx`, `BookWindow.tsx` — безопасный переход к точечной правке-удалению.
- `apps/desktop/src/renderer/editor/markers.ts`, `renderer/review/ReviewList.tsx`, `renderer/editor/ComparisonView.tsx`, `app.css` — семантика вставка/удаление/замена и компактный стек маркеров.
- `apps/desktop/src/renderer/book/ChapterSidebar.tsx`, `BookWindow.tsx`, `app.css` — переключатели панелей в их заголовках и floating triggers в свёрнутом состоянии.
- `apps/desktop/src/shared/api.ts`, `main/book-service.ts`, `main/ipc.ts`, `main/ipc.test.ts`, `preload/index.ts`, `renderer/TitleBar.tsx`, `BookWindow.tsx`, `app.css` — центрированный заголовок, путь и безопасное открытие папки книги.
- `apps/desktop/src/renderer/search/ChapterSearch.tsx`, `app.css` — геометрия строки поиска.
- `apps/desktop/src/renderer/ui/Notice.tsx`, `renderer/book/BookWindow.tsx`, `renderer/editor/ReviewEditor.tsx`, `app.css` — единый нижний слой стилизованных рабочих ошибок и предупреждений.
- `tests/desktop/diagnostics.spec.ts`, `review-actions.spec.ts`, `sidebar-layout.spec.ts`, `window-frame.spec.ts`, `search-and-appearance.spec.ts`, `notifications.spec.ts` — нативные регрессии и интеграционная приёмка.

---

### Task 1: Сделать крестик диагностики настоящей интерактивной областью

**Files:** Modify `apps/desktop/src/renderer/diagnostics/Diagnostics.tsx`, `apps/desktop/src/renderer/app.css`; Test `tests/desktop/diagnostics.spec.ts`.

**Interfaces:** `Diagnostics.requestClose(): void` остаётся единым путём закрытия; `close` native dialog вызывает родительский `onClose` и восстанавливает focus.

- [ ] **Step 1: Зафиксировать RED именно для pointer-пути.** В `diagnostics.spec.ts` открыть окно, кликнуть `button[name="Закрыть диагностику"]` реальным Playwright click и проверить исчезновение dialog и возврат фокуса к trigger. Не заменять клик `.evaluate(element => element.click())`: такой вызов обошёл бы draggable hit-testing, из-за которого Esc работает, а указатель — нет.
- [ ] **Step 2: Запустить `scripts/gui-test.sh npx playwright test tests/desktop/diagnostics.spec.ts -g "крестик" --workers=1` и подтвердить, что dialog остаётся открыт после pointer click.**
- [ ] **Step 3: Дать dialog и его интерактивным потомкам `-webkit-app-region: no-drag`.** Добавить класс `diagnostics__close` кнопке и CSS для `.diagnostics, .diagnostics button { -webkit-app-region: no-drag; }`; не менять `requestClose`, `onCancel` и `onClose`.
- [ ] **Step 4: Проверить pointer, Enter и Escape.** Запустить весь `tests/desktop/diagnostics.spec.ts` и компактный diagnostics-сценарий из `tests/desktop/window-frame.spec.ts`.
- [ ] **Step 5: Commit.** `git add apps/desktop/src/renderer/diagnostics/Diagnostics.tsx apps/desktop/src/renderer/app.css tests/desktop/diagnostics.spec.ts && git commit -m "fix(diagnostics): make dialog close control clickable"`.

### Task 2: Привязать панель действий к живой геометрии выделения

**Files:** Modify `apps/desktop/src/renderer/editor/ReviewEditor.tsx`, `apps/desktop/src/renderer/review/SignalFlyout.tsx`, `apps/desktop/src/renderer/app.css`; Test `tests/desktop/review-actions.spec.ts`.

**Interfaces:** Внутренний helper `publishSelectionWindow(view: EditorView): void` публикует `{from,to,x,y,bottom}` только для непустого видимого выделения и `null`, когда выделение вне viewport. `SignalFlyout` получает только опубликованные координаты; публичные props не расширяются.

- [ ] **Step 1: Добавить RED-сценарий hover + scroll round-trip.** Создать длинную главу, выделить текст, проверить изменение background кнопки по `hover()`, затем прокрутить `.cm-scroller` так, чтобы выделение вышло из viewport: flyout должен исчезнуть. Вернуть scrollTop: flyout должен снова появиться рядом с выделением, а само выделение и source/sidecar должны остаться неизменными.
- [ ] **Step 2: Запустить новый сценарий отдельно и подтвердить два сбоя: неизменный hover background и неподвижную/оставшуюся панель после scroll.**
- [ ] **Step 3: Вынести inline presentation из `SignalFlyout` в CSS.** Оставить inline только вычисляемые `left/top`; классы `.review-flyout` и `.review-flyout__action` задают surface, color, border и transition, а `:hover`/`:focus-visible` используют `var(--app-hover)`. Удалить inline `background: transparent`, которое сейчас сильнее общего hover-правила.
- [ ] **Step 4: Пересчитывать геометрию на selection и scroll.** В `ReviewEditor` helper читает текущий `view.state.selection.main`, `coordsAtPos(to)` и `view.scrollDOM.getBoundingClientRect()`. Если `coords.bottom < scroller.top` или `coords.top > scroller.bottom`, публиковать `null`; иначе публиковать clamp по viewport. Вызывать helper из `handleSelection` и через один `requestAnimationFrame` из `handleScroll`, чтобы не измерять layout несколько раз за кадр.
- [ ] **Step 5: Не воскресить toolbar во время record popup.** В `BookWindow` рендерить `SignalFlyout` только при `popup === null`; программный `ReviewEditorApi.reveal()` по-прежнему очищает flyout. Добавить assert, что переход из панели рецензии открывает только record popup.
- [ ] **Step 6: Проверить mouse, keyboard Tab и scroll.** Запустить `review-actions.spec.ts` с существующими сценариями создания четырёх типов сигналов и новым scroll-тестом.
- [ ] **Step 7: Commit.** `git add apps/desktop/src/renderer/editor/ReviewEditor.tsx apps/desktop/src/renderer/review/SignalFlyout.tsx apps/desktop/src/renderer/book/BookWindow.tsx apps/desktop/src/renderer/app.css tests/desktop/review-actions.spec.ts && git commit -m "fix(review): keep selection actions anchored while scrolling"`.

### Task 3: Отделить навигацию к удалению от выделения текстового диапазона

**Files:** Modify `apps/desktop/src/renderer/editor/ReviewEditor.tsx`, `apps/desktop/src/renderer/book/BookWindow.tsx`; Test `tests/desktop/review-actions.spec.ts`.

**Interfaces:** Заменить `ReviewEditorApi.reveal(recordId): boolean` на `reveal(recordId): { x:number; y:number; bottom:number } | null`. Для диапазона `from < to` API выделяет и центрирует текст; для удаления `from === to` центрирует точку/виджет без создания фиктивного непустого диапазона и возвращает координаты после measure.

- [ ] **Step 1: Добавить RED для удаления в начале, середине и EOF длинной главы.** Кликнуть sidebar record, проверить, что `.cm-content` сохраняет полный `textContent`, целевая deletion placeholder находится во viewport, scrollTop конечен и record popup открыт. Отдельно проверить replacement и insertion, чтобы не сломать работающие переходы.
- [ ] **Step 2: Запустить только новый test matrix и сохранить фактическую точку сбоя до изменения реализации.** Не кодировать предположение о причине в production code до RED.
- [ ] **Step 3: Реализовать point reveal.** Для `from === to` вызвать `EditorView.scrollIntoView(from, { y: 'center' })`, дождаться `view.requestMeasure`, найти `[data-record-id="..."]` в `view.dom` и взять его rect; если widget ещё не материализован, использовать `coordsAtPos(from)`. Не передавать `record.to` из устаревающего React snapshot обратно в `coordsAt`: геометрия должна происходить из того же `mappedVisualRecords`, по которому выполнен reveal.
- [ ] **Step 4: Перевести `BookWindow.selectRecord` на возвращённую геометрию.** Popup открывается у результата `reveal`; `null` означает настоящую невозможность перехода и раскрывает карточку в sidebar. Не очищать manuscript и не выполнять command.
- [ ] **Step 5: Запустить новый matrix, весь `review-actions.spec.ts` и `npx vitest run apps/desktop/src/renderer/editor/markers.test.ts apps/desktop/src/renderer/editor/visual-range.test.ts`.**
- [ ] **Step 6: Commit.** `git add apps/desktop/src/renderer/editor/ReviewEditor.tsx apps/desktop/src/renderer/book/BookWindow.tsx tests/desktop/review-actions.spec.ts && git commit -m "fix(review): reveal deletion records without blanking the viewport"`.

### Task 4: Унифицировать визуальную семантику правок и сложить маркеры в стек

**Files:** Modify `apps/desktop/src/renderer/editor/visual-range.ts`, `visual-range.test.ts`, `markers.ts`, `markers.test.ts`, `renderer/review/ReviewList.tsx`, `renderer/editor/ComparisonView.tsx`, `renderer/app.css`; Test `tests/desktop/review-actions.spec.ts`, `tests/desktop/sidebar-layout.spec.ts`.

**Interfaces:** Экспортировать `editKind(record): 'insertion' | 'deletion' | 'replacement'`: `before === ''` → insertion, `after === ''` → deletion, иначе replacement. Все три представления используют один helper. Accessible label остаётся полным текстом правки.

- [ ] **Step 1: Написать unit RED для классификации трёх видов, включая визуально обрезанную replacement.** Классифицировать исходный `RecordView`, а не результат `visualRecord`, чтобы общий prefix/suffix не превратил replacement в ложную insertion/deletion.
- [ ] **Step 2: Добавить Electron RED для списка.** Insertion имеет `IconPlus` и только строку «Стало»; deletion — `IconMinus` и только «Было»; replacement — `IconPencil` и обе строки. Видимые слова «Было/Стало» заменить компактными иконками minus/plus с `aria-hidden`, сохранив эти слова в полном `aria-label`/Tooltip.
- [ ] **Step 3: Реализовать helper и переиспользовать его в ReviewList, gutter и ComparisonView.** Deletion использует `deletionColor(theme)`, insertion/replacement — `EDIT_MARKER_COLOR`; не менять цвета сигналов и comparison tints.
- [ ] **Step 4: Исправить line-height карточки.** `.book__record-summary`, `.book__record-part` и `.book__record-excerpt` получают согласованный `line-height: 1.35`; icon-cell имеет фиксированные 18 px и `align-self: start`, без текстовой колонки шириной 3.25rem. Проверить screenshot из журнала на 240/336/560 px.
- [ ] **Step 5: Сделать gutter фиксированной ширины.** `gutterGeometry` больше не выставляет `columns * 24 + 8`; ширина `.gd-review-gutter` постоянна 32 px. Каждая кнопка получает CSS custom property `--gd-stack-index`; в покое маркеры перекрываются со сдвигом 3 px и обратным z-index, а при `:hover`/`:focus-within` контейнер разворачивает их горизонтально поверх reading surface (`left: calc(var(--gd-stack-index) * 24px)`, `z-index` выше текста) без изменения ширины gutter и без reflow редактора.
- [ ] **Step 6: Добавить regression на строку с 4+ маркерами.** До/после hover измерить ширину `.gd-review-gutter` и `.cm-content`, убедиться, что они неизменны; каждая кнопка доступна pointer и последовательным Tab, а после ухода/blur стек снова сложен.
- [ ] **Step 7: Прогнать unit и native тесты.** `npx vitest run apps/desktop/src/renderer/editor/visual-range.test.ts apps/desktop/src/renderer/editor/markers.test.ts`; `scripts/gui-test.sh npx playwright test tests/desktop/review-actions.spec.ts tests/desktop/sidebar-layout.spec.ts --workers=1`.
- [ ] **Step 8: Commit.** `git add apps/desktop/src/renderer/editor apps/desktop/src/renderer/review/ReviewList.tsx apps/desktop/src/renderer/app.css tests/desktop/review-actions.spec.ts tests/desktop/sidebar-layout.spec.ts && git commit -m "feat(review): distinguish edit kinds and stack gutter markers"`.

### Task 5: Перенести переключатели панелей к самим панелям

**Files:** Modify `apps/desktop/src/renderer/book/ChapterSidebar.tsx`, `apps/desktop/src/renderer/book/BookWindow.tsx`, `apps/desktop/src/renderer/app.css`; Test `tests/desktop/sidebar-layout.spec.ts`, `tests/desktop/workspace-layers.spec.ts`, `tests/desktop/window-frame.spec.ts`.

**Interfaces:** `ChapterSidebar` получает `onCollapse(): void`. Видимые заголовки имеют «Скрыть оглавление»/«Скрыть рецензию»; свёрнутые состояния показывают floating «Показать оглавление»/«Показать рецензию». На responsive layout floating trigger открывает прежний dialog-overlay.

- [ ] **Step 1: Добавить RED для wide и narrow layout.** На 1280 px toggle находится внутри соответствующего `aside`, скрывает панель и оставляет floating кнопку у того же края; повторный click возвращает панель и focus. На 700/900 px обе недоступные по ширине панели открываются floating triggers как overlays; Escape закрывает overlay и возвращает focus.
- [ ] **Step 2: Удалить panel toggles из `.book__toolbar`.** Не менять search/view/Zen/menu. Встроить collapse button в `.book__chapters-heading`; для review создать `.book__panel-heading` с `h2` и кнопкой.
- [ ] **Step 3: Добавить floating rail поверх `.book__body`.** Кнопки абсолютно позиционированы слева/справа, не участвуют в grid columns, не уменьшают reading width и скрыты в Zen. Различать user-hidden и responsive-collapsed через уже существующие `chaptersCollapsed/reviewCollapsed` и `toggleSidebar`.
- [ ] **Step 4: Сохранить доступность и focus.** При закрытии панели focus переходит на её floating trigger; при открытии — на heading/первое действие. Overlay close возвращает focus на trigger. Обновить `overlayPanelRef` autofocus без зависимости от удалённых titlebar refs.
- [ ] **Step 5: Прогнать три layout/chrome spec и проверить отсутствие horizontal overflow.**
- [ ] **Step 6: Commit.** `git add apps/desktop/src/renderer/book/ChapterSidebar.tsx apps/desktop/src/renderer/book/BookWindow.tsx apps/desktop/src/renderer/app.css tests/desktop/sidebar-layout.spec.ts tests/desktop/workspace-layers.spec.ts tests/desktop/window-frame.spec.ts && git commit -m "feat(layout): colocate sidebar visibility controls"`.

### Task 6: Перестроить book titlebar и безопасно открыть папку книги

**Files:** Modify `apps/desktop/src/shared/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/book-service.ts`, `apps/desktop/src/main/book-service.test.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/ipc.test.ts`, `apps/desktop/src/main/main.ts`, `apps/desktop/src/renderer/TitleBar.tsx`, `apps/desktop/src/renderer/book/BookWindow.tsx`, `apps/desktop/src/renderer/app.css`; Test `tests/desktop/window-frame.spec.ts`, `tests/desktop/open-book.spec.ts`.

**Interfaces:** `BookView` добавляет `path: string` из canonical `BookHandle.root`. `DeskApi.openBookFolder(bookId: string): Promise<void>` принимает только opaque id открытой книги. Main получает root через `service.getBookRoot(bookId)`, вызывает инъецированный `openPath(root)` и преобразует непустой ответ shell в `IpcError('SAVE_FAILED', ...)`.

- [ ] **Step 1: Написать IPC RED.** Валидный открытый `bookId` открывает только root из service; неизвестный/пустой id возвращает `BOOK_MISSING`; лишний renderer argument с `/etc/passwd` игнорируется и никогда не попадает в `openPath`; непустая строка ошибки shell видна вызывающему коду.
- [ ] **Step 2: Написать BookView contract RED.** `chooseBook`, `openRecent`, `manageBook` и `discoverChapters().book` возвращают один canonical `path`; rename не меняет его.
- [ ] **Step 3: Провести typed IPC вертикально.** Добавить поле/метод в shared API, preload channel `desk:open-book-folder`, handler с trusted sender в `ipc.ts` и wrapper `shell.openPath` в `main.ts`. Не использовать `shell.showItemInFolder` для директории и не принимать path от renderer.
- [ ] **Step 4: Расширить `TitleBar` явными book props.** `subtitle?: string`, `status?: ReactNode`, `onOpenLocation?: () => void`; welcome screen продолжает передавать только title. Для книги render `.titlebar__identity`: крупный title + save status в первой строке, canonical path мелким ellipsis во второй, рядом `IconFolderOpen` с label/Tooltip «Открыть папку книги».
- [ ] **Step 5: Переместить save indicator из action toolbar к названию.** Сохранить `role=status`, readonly/error/external цвета и no-drag только для кнопки; текстовая identity остаётся drag-областью. Ошибку `openBookFolder` показать в существующем visible book error region, не глотать.
- [ ] **Step 6: Настроить chrome на 900/1280/1920 px.** Identity центрирована в доступном пространстве, title крупнее текущих `.88em`, path не переносит topbar, действия и system controls не обрезаются. При тесной ширине сначала скрывать визуальный path (полный путь остаётся Tooltip/accessible description), затем ellipsize title; не скрывать save error.
- [ ] **Step 7: Native acceptance.** В `window-frame.spec.ts` проверить title/path/status и отсутствие второго book heading; подменить `shell.openPath`, нажать folder button и проверить canonical root. Повторить packaged window test на 900 px и macOS traffic-light layout, если host доступен.
- [ ] **Step 8: Commit.** `git add apps/desktop/src/shared/api.ts apps/desktop/src/preload/index.ts apps/desktop/src/main apps/desktop/src/renderer/TitleBar.tsx apps/desktop/src/renderer/book/BookWindow.tsx apps/desktop/src/renderer/app.css tests/desktop/window-frame.spec.ts tests/desktop/open-book.spec.ts && git commit -m "feat(chrome): show book location and open its folder"`.

### Task 7: Исправить внутренние отступы строки поиска

**Files:** Modify `apps/desktop/src/renderer/search/ChapterSearch.tsx`, `apps/desktop/src/renderer/app.css`; Test `tests/desktop/search-and-appearance.spec.ts`.

**Interfaces:** Search contract и keyboard behavior не меняются; меняется только layout wrapper.

- [ ] **Step 1: Добавить geometry RED.** На 900 и 1280 px измерить расстояние между label/input, input/counter и counter/buttons: не менее 8 px; внутренний horizontal padding панели — 10–12 px; элементы не пересекаются и searchWidth не превышает contentWidth.
- [ ] **Step 2: Ввести внутренние группы.** `.book__search` получает `padding-inline: 12px` и `gap: 8px`; counter + arrows + close объединить в `.book__search-actions` с `gap: 4px`, input остаётся `flex: 1 1 12rem; min-width: 8rem`. При узкой ширине разрешить wrap между input и actions, не внутри action group.
- [ ] **Step 3: Проверить неизменность поведения.** Сразу подсвечивается 1/N, Enter/Shift+Enter и стрелки цикличны, Escape сначала очищает запрос и затем закрывает поиск с возвратом focus.
- [ ] **Step 4: Запустить `scripts/gui-test.sh npx playwright test tests/desktop/search-and-appearance.spec.ts --workers=1` и сделать light/dark screenshot панели на 900 px.**
- [ ] **Step 5: Commit.** `git add apps/desktop/src/renderer/search/ChapterSearch.tsx apps/desktop/src/renderer/app.css tests/desktop/search-and-appearance.spec.ts && git commit -m "fix(search): space the search controls consistently"`.

### Task 8: Собрать рабочие ошибки в плавающий нижний центр уведомлений

**Files:** Create `apps/desktop/src/renderer/ui/Notice.tsx`, `tests/desktop/notifications.spec.ts`; Modify `apps/desktop/src/renderer/book/BookWindow.tsx`, `apps/desktop/src/renderer/editor/ReviewEditor.tsx`, `apps/desktop/src/renderer/app.css`, `tests/desktop/workspace-layers.spec.ts`.

**Interfaces:** `NoticeProps = { kind: 'error' | 'warning' | 'info'; title?: string; children: ReactNode; actions?: ReactNode; onDismiss?: () => void }`. `NoticeCenter` — единственный контейнер внутри `.book`; `role="alert"` используется для новых ошибок, `role="status"` — для informational warning. Уведомления не исчезают по таймеру: их убирает разрешение состояния или явная кнопка закрытия.

- [ ] **Step 1: Зафиксировать RED для текущей полосы над редактором.** В новом `notifications.spec.ts` вызвать отказ `desk.openChapter`/рабочей операции и проверить, что `.app__error` сейчас участвует в document flow над `.book__body`. Целевой контракт: notice находится поверх editor, его bounding box центрирован по viewport, нижний отступ 16–24 px, размеры `.book__body` и `.cm-scroller` до/после ошибки не меняются.
- [ ] **Step 2: Создать themed primitives.** `Notice` рисует Tabler icon по kind, текст, actions и опциональную кнопку `IconX` с полным `aria-label`; `NoticeCenter` рендерит стек. CSS: `.book { position: relative; }`, center `position: absolute; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(640px, calc(100% - 32px)); z-index: 46; pointer-events: none`; карточки возвращают `pointer-events: auto`, используют `var(--app-panel)`, `var(--app-text)`, `var(--app-error-text)`, `var(--desk-warning)` и `var(--app-dialog-shadow)`.
- [ ] **Step 3: Перенести только book-level состояния.** В `NoticeCenter` собрать: `saveError` с недисмиссабельным действием «Перечитать главу»; общий `error` с dismiss → `setError(null)`; `layoutError` с «Повторить сохранение ширины»; `openWarning` с «Скрыть»; `snapshot.readOnlyReason` как постоянное warning; `snapshot.saveState === 'external'` вместе с существующими resolve/export actions. Удалить прежние flow-блоки `.book__save-error`, `.book__layout-error`, `.book__external-actions` над `.book__body`.
- [ ] **Step 4: Убрать дубликат ошибки очереди редактора.** Добавить `ReviewEditor` callback `onCommandError(message: string | null): void`; queue сообщает родителю строку «локальный текст сохранён…», а успешная синхронизация сообщает `null`. `BookWindow` сводит её в тот же `saveError`, поэтому одновременно показывается одна карточка с одним reread action, а `queue.blocked` остаётся неизменным.
- [ ] **Step 5: Оставить контекстные ошибки локальными.** Не переносить ошибки `MetadataPopover`, `ChapterDialogs`, `RenameBookDialog`, `ChapterNote`, `Diagnostics`, `RecentBooks` и `ErrorBoundary`: они относятся к конкретной форме/экрану и должны оставаться возле соответствующего действия. Зафиксировать это отдельными assertions, чтобы общий notice не дублировал form alert.
- [ ] **Step 6: Проверить layering и input.** Notice не перехватывает click/selection/scroll за пределами собственной карточки; его кнопки работают мышью и клавиатурой. Native `<dialog>` и metadata popover остаются выше; Tooltip не обрезается. При двух одновременных состояниях карточки складываются вверх, имеют gap 8 px и не выходят за viewport.
- [ ] **Step 7: Проверить темы, responsive и доступность.** Light/dark × 900/1280/1920 px × 100/125%; accessible snapshot содержит один alert на логическую ошибку. Ошибка длиннее одной строки переносится, действия не обрезаются; на 900 px карточка не перекрывает floating sidebar triggers.
- [ ] **Step 8: Прогнать `scripts/gui-test.sh npx playwright test tests/desktop/notifications.spec.ts tests/desktop/workspace-layers.spec.ts tests/desktop/review-actions.spec.ts --workers=1` и `npm run typecheck`.**
- [ ] **Step 9: Commit.** `git add apps/desktop/src/renderer/ui/Notice.tsx apps/desktop/src/renderer/book/BookWindow.tsx apps/desktop/src/renderer/editor/ReviewEditor.tsx apps/desktop/src/renderer/app.css tests/desktop/notifications.spec.ts tests/desktop/workspace-layers.spec.ts tests/desktop/review-actions.spec.ts && git commit -m "feat(ux): float styled work errors over the editor"`.

### Task 9: Интеграционная приёмка всей партии

**Files:** Create `docs/reviews/evidence/found-bugs/README.md`; Test all changed suites; no production changes unless a test demonstrates an interaction regression.

**Interfaces:** Итоговый evidence перечисляет bug 1–10, test/screenshot и PASS/FAIL; недоступную платформу помечает `NOT RUN`, а не `PASS`.

- [ ] **Step 1: Прогнать статические проверки.** `npm run typecheck`, `npm test`, `npm run test:contracts`, `npm run check:security`.
- [ ] **Step 2: Прогнать затронутые Electron suites одной командой.** `scripts/gui-test.sh npx playwright test tests/desktop/diagnostics.spec.ts tests/desktop/review-actions.spec.ts tests/desktop/sidebar-layout.spec.ts tests/desktop/workspace-layers.spec.ts tests/desktop/window-frame.spec.ts tests/desktop/search-and-appearance.spec.ts tests/desktop/open-book.spec.ts tests/desktop/notifications.spec.ts --workers=1`.
- [ ] **Step 3: Проверить временную копию реальной книги.** Не менее 20 глав и 20–30 записей: insertion/deletion/replacement, несколько маркеров одной строки, sidebar collapse/overlay, selection toolbar scroll-away/return, deletion navigation, search, open-folder и искусственно вызванный рабочий error notice. До и после сравнить SHA-256 всех Markdown/sidecar; изменения допустимы только в тестовой копии и только там, где сценарий сознательно создаёт запись.
- [ ] **Step 4: Снять evidence.** Light/dark × 900/1280/1920 × 100/125%; отдельные кадры titlebar, search, compact review rows, collapsed sidebar triggers, marker stack в покое/hover и нижний error notice с действием. Записать host OS и отсутствующие платформы в `README.md`.
- [ ] **Step 5: Собрать приложение.** `npm run package`; запустить packaged smoke и повторить close diagnostics, open book folder, deletion navigation и responsive sidebar на собранном бинарнике.
- [ ] **Step 6: Self-review плана и реализации.** Сверить каждый пункт 1–10 с evidence; проверить, что план не привёл к новым IPC с произвольным path, смене sidecar schema, reflow reading width, дублирующим alert или потере keyboard path.
- [ ] **Step 7: Commit.** `git add docs/reviews/evidence/found-bugs && git commit -m "docs: record found bugs acceptance"`.

## Соответствие журналу и дополнению пользователя

| Пункт | Задача | Проверяемый результат |
|---|---:|---|
| 1. «Было / Стало», line-height | 4 | компактные icon rows и ровная высота строки |
| 2. Крестик диагностики | 1 | реальный pointer click закрывает dialog |
| 3. Переключатели сайдбаров | 5 | toggle в header, floating trigger в collapsed state |
| 4. Название/путь/open folder | 6 | identity в titlebar и безопасный main-owned openPath |
| 5. Hover и scroll панели выделения | 2 | hover видим, flyout следует видимому selection |
| 6. Навигация к удалению | 3 | point reveal без пустого viewport |
| 7. Несколько gutter icons | 4 | стек разворачивается поверх текста без сужения |
| 8. Отступы поиска | 7 | стабильные padding/gap на узком и широком окне |
| 9. Иконки insertion/deletion | 4 | +/−/pencil и только существующие before/after rows |
| 10. Нестилизованные ошибки над редактором | 8 | themed notices плавают снизу по центру без reflow редактора |
