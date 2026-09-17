# Workspace UX: интеграционная приёмка 2026-09-17

Проверка выполнена на Linux от базы `664b3e9`. Каждая GUI-команда запускала
собственный Xvfb и Openbox с окружением DBus/KDE/GTK из release runbook.
Профили и книги были одноразовыми; установленное приложение не запускалось и
не обновлялось.

## Автоматические gates

| Команда | Результат |
| --- | --- |
| `npm test` | PASS: 36 файлов / 461 тест |
| `npx tsc -b --force --pretty false` | PASS |
| `npm run package` | PASS |
| `ANDROID_HOME=/home/inky/Android/Sdk npm run test:contracts` | PASS: Kotlin `BUILD SUCCESSFUL`, 21/21 TS |
| `npm run test:desktop -- --workers=1` с packaged executable | PASS: 102 passed / 1 ожидаемый performance skip |

Контрактный прогон использовал detached checkout Pocket на pinned
`f4aa28e2c3f4035502ba4f51cd9b668a867b1527`. Performance остаётся отдельной
командой release runbook и в обычном native suite намеренно пропущен.

## Undo/Redo и найденные регрессии

Два новых native-сценария создают одну завершённую группу ввода в середине
слова и на границе абзаца. В каждом случае один Undo восстанавливает исходный
текст и точные edits/signals, Redo возвращает тот же изменённый snapshot,
соседние записи не меняются. После второго Undo, flush, закрытия и открытия
decoded sidecar возвращает исходный текст; note и соседний signal совпадают.

Полный прогон выявил устаревшие ожидания старых тестов после Workspace UX:
accessible name главы теперь равен только title, отдельный `.book__title`
удалён единым chrome, активность живёт на row, Escape не выключает Zen, а
ошибки popover/global имеют отдельные alerts. Исправлены только эти точные
селекторы и ожидаемое поведение. Failure-path тесты после всех проверок явно
останавливают принадлежащий тесту Electron: намеренно неразрешённый save error
не может пройти graceful close gate. Assertions ошибок сохранены.

Restart-проверка позиции требует тот же первый видимый текстовый ряд и
геометрическую разницу не больше одной строки (31px). Same-window путь всё ещё
требует точные 120px. Это соответствует принятому контракту Task 12: anchor
персистентен, дробный topOffset хранится только внутри текущего окна.

## Визуальная матрица

Скрипт [capture.mts](evidence/workspace-ux/task-13/capture.mts) воспроизводит
проверку на временной копии книги. [Contact sheet](evidence/workspace-ux/task-13/contact-sheet.png)
собирает все кадры; отдельные PNG лежат в той же папке.

- 12 кадров: light/dark × 900/1280/1920 × 100/125%.
- Дополнительно: обычная глава, chapter menu, Discovery, sort preview,
  metadata popover, themed tooltip, поиск с первой находкой, плотная рецензия,
  comparison в середине главы и Zen.
- Во всех осмотренных кадрах одна верхняя строка, нет отдельной «бумаги» в
  центре, toolbar и действия не обрезаны. Кадр Task 11 сохранён отдельно как
  [task-11-dense-review.png](evidence/workspace-ux/task-13/task-11-dense-review.png).

## Реальная книга и истории

Источник `/home/inky/Документы/test-book` только читался и копировался во
временный каталог. В копии: 27 Markdown-файлов, 8 sidecar и 144 edits/signals.
SHA256 дерева источника до и после совпал:
`55253e0c7ff59af1ccac74ef4cefa6d0df90fd9e5089de58e912f334d5920046`.
[Машиночитаемый результат](evidence/workspace-ux/task-13/capture-result.json).

| История | Результат и evidence |
| --- | --- |
| №1, folder/recent parity | PASS на реальной копии: picker открыл книгу, Recent повторно открыл ту же активную главу; `capture-result.json` story 1 |
| №6, Zen | PASS на реальной копии: два Escape сохранили Zen, `Ctrl+Alt+Z` вышел; [Zen](evidence/workspace-ux/task-13/real-book-zen.png), story 6 |
| №7, общий Tooltip | PASS на реальной копии: общий themed tooltip появился от keyboard focus; [tooltip](evidence/workspace-ux/task-13/real-book-themed-tooltip.png), story 7 |
| №8, первая находка | PASS на реальной копии: input сохранил focus, единственная подсветка первой находки видима; [search](evidence/workspace-ux/task-13/real-book-search-first-match.png), story 8 |
| №9, фильтр/sidebar | PASS на реальной копии: filename-фильтр сократил 27 глав до `chapter-015.md`, очистка вернула 27; story 9 |
| №10, плотная рецензия | PASS на реальной копии: `chapter-003.md` отрисовал все 36 записей; [dense review](evidence/workspace-ux/task-13/real-book-dense-review.png), story 10 |
| №11, reading position | PASS на реальной копии: Text → Comparison → close → Recent reopen → Comparison → Text сохранили тот же видимый центральный ряд; [comparison](evidence/workspace-ux/task-13/real-book-comparison-middle.png), story 11 |
| №12, atomic Undo | PASS на реальной копии: middle-word и paragraph-boundary дали точный текст и records после Undo/Redo; story 12 |

Пересечения dirty metadata/remove, resize/position, sort/filter, pending
close, Zen из popup и двойной Escape, tooltip/Escape/search, поиск/view,
comparison/close/reopen покрыты полным набором `metadata`, `book-management`,
`sidebar-layout`, `close-pending`, `search-and-appearance`, `tooltips`,
`comparison-position` и `open-book`. Подсветка активной главы не оформлялась
как новый bugfix: обычная регрессия active row остаётся в native suite.

## Ограничения

macOS недоступен: ручная Mac-проверка, native picker/clipboard/IME,
traffic lights и Cmd-сочетания — **not-run**, а не PASS. Старый отложенный
macOS selection failure остаётся открытым. Linux system IME также not-run.
Схемы Pocket, manifest и sidecar не изменялись; cross-platform совместимость
формата подтверждена контрактами, но это не заменяет runtime на второй ОС.

## Final whole-branch review fixes

The final review correctly identified clipped chapter menus and metadata, note-draft
loss across responsive branches, competing Escape owners, and unbounded large
passive previews. The follow-up uses an App-themed fixed portal for chapter menus
and metadata, retains note draft/open/error/busy state per chapter in BookWindow,
defers workspace Escape to native dialogs and nested forms, blocks Zen beneath
Diagnostics, and wraps/clips oversized shared tooltips. Full record content remains
available in the existing click-open card. Collapsed-sidebar dialog cancellation
returns focus to the chapter toggle; system and search-step controls now use Tooltip.

`workspace-layers.spec.ts` asserts actual painted menu hit targets (including the
last row), unsaved-note and failed-save state across hide/show, collapse/overlay,
expand and Zen, single-layer Escape, Diagnostics shortcut isolation, and long-token
multiline previews at 125%. The existing metadata native suite still verifies
focus, validation, guarded saves and discard behavior.

The real-copy capture was refreshed after these changes. It asserts menu hit
geometry without sidebar horizontal scrolling and metadata viewport bounds with
long YAML and discard confirmation at 1100/900 px and 125%. The original book hash
is unchanged: `55253e0c7ff59af1ccac74ef4cefa6d0df90fd9e5089de58e912f334d5920046`.
The contact sheet was regenerated from current captures. Individually inspected:

- [Visible first-row menu](evidence/workspace-ux/task-13/real-book-sidebar-menu.png)
- [Visible last-row menu](evidence/workspace-ux/task-13/real-book-last-row-menu.png)
- [Narrow overlay menu](evidence/workspace-ux/task-13/real-book-overlay-menu.png)
- [Metadata form](evidence/workspace-ux/task-13/real-book-metadata.png)
- [1100 px / 125% discard](evidence/workspace-ux/task-13/real-book-metadata-1100-125-discard.png)
- [900 px / 125% discard](evidence/workspace-ux/task-13/real-book-metadata-900-125-discard.png)

macOS and system IME remain not run; this correction does not change that limitation.

Final correction gates: **104 native passed / 1 expected performance skip** (one
full isolated run), **461 unit tests passed**, typecheck/package/diff check passed.
No contract-related files changed in this correction.


### Остаток заключительного ревью (2026-09-17)

P2: после Escape, закрывающего меню главы, фокус возвращается на его кнопку. Следующий Escape поглощается и не закрывает панель/поиск. Явные кнопки закрытия работают; потери данных нет. Остаток отложен после одного финального цикла исправлений по SDD. Это известный дефект, а не подтверждённый PASS сценария двух последовательных Escape.

Linux gates на `ec589b0`: 461 unit; 104 native PASS, 1 ожидаемый performance-skip; typecheck/package PASS. [Заключительное ревью](./evidence/workspace-ux/final-review/final-rereview.md). macOS/системный IME не проверены.
