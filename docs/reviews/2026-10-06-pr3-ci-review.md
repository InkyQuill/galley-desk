# PR #3: CI, CodeRabbit и тестовая обвязка

База: `e0ede10`, Linux x64, 2026-10-06.

## Найденные причины

- Linux CI запускал собственную обёртку вместо `scripts/gui-test.sh`: отсутствовал обязательный `ELECTRON_OZONE_PLATFORM_HINT=x11`.
- macOS GUI-job не мог пройти Linux/Xvfb guard. Сохранены typecheck, unit и Forge package; GUI явно NOT RUN.
- Playwright включал Vitest-файл `gui-isolation.test.ts`. Теперь он выбирает только `*.spec.ts`.
- Xvfb по умолчанию давал 640×480: responsive UI скрывал оглавление в тестах управления книгой. Задан воспроизводимый экран 1920×1080; сценарии узких окон по-прежнему задают собственные размеры.

## Исправления ревью

Исправлены восемь подтверждённых замечаний: пояснение обычного внешнего изменения; названия вставки/удаления/замены в списке и сравнении; экранирование pipe в таблице; переносимая ссылка на внешний отчёт; GUI-команды плана через общую обёртку; CI entry points; ожидание готовности Openbox; отказ удалённому DISPLAY.

## Соразмерность обвязки

Оставлены одна обёртка Xvfb/Openbox и однократный guard перед Playwright. Проверка live Xvfb, локального DISPLAY и x11 нужна из-за ранее наблюдавшегося выхода Electron на рабочий Wayland-дисплей. Удалены повторяющиеся пояснения и проверки точного текста ошибок; остались проверки опасных вариантов запуска. Нет новых зависимостей, retry или увеличения timeout.

Два способа запуска Electron оправданы: обычные тесты управляют IPC/диалогами через Playwright, а packaged CDP запускает фактический executable без Node inspector и изменения production fuses. Проверка ограничения времени старта и остановки дочернего процесса предотвращает зависшие процессы. Performance остаётся отдельной opt-in проверкой; новая матрица скриншотов не добавлялась.

## Верификация

- `npm run typecheck`: PASS.
- `npm test`: PASS, 37 файлов / 486 тестов.
- `npm run package`: PASS, Linux x64.
- `GALLEY_PACKAGED_EXECUTABLE=<собранный Linux executable> scripts/gui-test.sh npm run test:desktop -- --workers=1`: PASS, 122 passed / 1 performance skip, 2.2 минуты. Включает packaged management и byte-exact save/restart/apply/undo.
- Openbox exits / readiness timeout: две отдельные проверки PASS; команда пользователя в обоих случаях не запускалась.
- `npm run check:security`: PASS как выполнение сканера, 36 atomic / 6 global, 0 parser errors, 6 ранее описанных в `security.md` находок.
- `bash -n scripts/gui-test.sh`, `git diff --check`: PASS.
- Локальные contracts: NOT RUN, форматы/контракты не менялись; исходный remote Contracts на базе PR зелёный.
- macOS GUI / native IME: NOT RUN.

Первый полный прогон после изменения названий выявил три ошибочных селектора: два ошибочно переименованных gutter-селектора и неоднозначное частичное имя удаления. Исправлены без ослабления assertions; приведены результаты повторного полного прогона.
