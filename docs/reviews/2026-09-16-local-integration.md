# Локальная интеграция 0.1 — 2026-09-16

Пользователь выбрал локальное слияние. Push и публикация не выполнялись.

| Проект | Итог локального main | Проверка после слияния |
| --- | --- | --- |
| Desk | production `3d7627a` (затем только документация/пины) | typecheck; 278 unit; 21 contracts; package; 48 desktop + 1 явный perf skip; отдельный performance PASS |
| Pocket | `f4aa28e2c3f4035502ba4f51cd9b668a867b1527` | testDebugUnitTest, lintDebug, assembleDebug, assembleDebugAndroidTest PASS |
| Editor/themes | `89a424fea51a026c9fcc5d8d45ea7390d96fc2a1` | 526 editor + 11 themes, lint PASS |
| Pad | `dcc6bedb233e35493dc6d7c15ad280307fa1bef5` | полный mise run verify PASS: audit, 275 unit, 20 scripts, 19 integration, 40 Rust, build/Tauri |

Editor main обновлён через отдельный временный worktree: исходная рабочая
ветка с пользовательскими изменениями не переключалась. Конфликты merge
в package.json двух пакетов и lockfile сводились к версиям: сохранены
релизные 0.14.0. Итоговый diff к обновлённому main — только проверенный
тест tableEditing. Pad сохраняет релиз 1.6.1, Pocket — 0.6.0.
Эти номера не означают публикацию новых исправлений.

## Дополнительный дефект, найденный при интеграции

Первый desktop-прогон после слияния остановлен после ложного STALE_REVISION
в сценарии быстрого ввода. Наблюдатель сравнивал ревизию, захваченную до
входа в очередь, с ревизией после собственного сохранения. Детерминированная
регрессия воспроизвела лишнюю смену снимка. `checkExternal` теперь сообщает
результат, вычисленный внутри своей операции очереди; проверка настоящих
внешних изменений и stale-команд сохранена.

Исправление `3d7627a` прошло [отдельное ревью](2026-09-16-merge-watcher-review.md)
без блокирующих замечаний. [RED/GREEN и целевые проверки](2026-09-16-merge-watcher-fix.md).
[Прерванный исходный прогон](2026-09-16-evidence/local-merge/desktop-before-watcher-fix.log)
сохранён; он не засчитывался как успешный.

## Свежие проверки Desk main

- `npm test`: 278 passed, 21 files.
- `npm run typecheck`: exit0.
- `ANDROID_HOME=/home/inky/Android/Sdk POCKET_EDITOR_DIR=/home/inky/Development/pocket-editor npm run test:contracts`: Kotlin BUILD SUCCESSFUL и TS21 passed. ANDROID_HOME задан явно: при запуске из Desk SDK не находился автоматически.
- `npm run package`: PASS, production fuses сохранены.
- `npm run test:desktop -- --workers=1` с GALLEY_PACKAGED_EXECUTABLE на пакет в основном каталоге: [48 passed / 1 perf skip](2026-09-16-evidence/local-merge/desktop-final.log).
- `GALLEY_PERF=1 npx playwright test tests/desktop/performance.spec.ts --workers=1`: PASS. Открытие995ms ≤2000, input-to-DOMp95 22.8ms ≤50; [samples](2026-09-16-evidence/local-merge/performance-results.json). Confirmed-savep95 906.9ms включает polling/проверку sidecar, не является временем физического fsync.

Среда GUI взята из текущей Linux-сессии: DISPLAY=:0,
XAUTHORITY=/run/user/1000/xauth_GiQaAf,
GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module; цветовые переменные
очищены через env -u NO_COLOR -u FORCE_COLOR. Это зафиксированные значения
данного прогона, не переносимая настройка. Эмулятор в этом замере остановлен.
Нативный Mac/system IME по-прежнему не запускались; прошлые Android
instrumentation и двусторонний roundtrip остаются доказательствами A7,
а не повторным instrumentation-прогоном этого merge.

Новый portable ZIP находится в основном каталоге:
`apps/desktop/out/make/zip/linux/x64/Galley Desk-linux-x64-0.1.0.zip`.
Он создан проверенным Python helper из нового пакета; CRC и execute bit
проверены. [SHA256](2026-09-16-evidence/local-merge/artifact-sha256.txt).
Отдельный запуск после распаковки ZIP не заявляется.

## Сохранность текущей работы

Незакоммиченные иконки, ADR и материалы дизайна Desk оставлены как есть.
Старая рабочая копия аудита уже представлена в истории принятой ветки;
перед merge она была дополнительно сохранена в отдельный backup stash.
Рабочая ветка Editor и чужие worktrees не изменялись. Временные worktrees
только этой интеграции удаляются после проверок. Внутренний task-4 scratch
report убран из текущего дерева; результат сохранён в итоговых отчётах и git.

Неблокирующий прежний Save As timing test Pad и предупреждения инструментов
сохранены в истории проверки. npm ci Editor также сообщает advisories
существующих dev-зависимостей; audit Editor здесь не объявляется зелёным.
