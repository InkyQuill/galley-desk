# Runbook: выпуск настольного приложения Galley Desk

Чек-лист выпуска для Linux и macOS. Подпись и нотаризация пока **не
выполняются** — учётных данных нет (см. «Подпись и нотаризация» ниже);
шаги описаны так, как их нужно будет выполнить, и не считаются сделанными.

## 0. Предусловия

- Чистое рабочее дерево на `main`, CI (workflows `Contracts` и `Desktop`)
  зелёные на релизном коммите.
- Версии согласованы: `@inkyquill/galley-editor`,
  `@inkyquill/galley-themes` в `apps/desktop/package.json` (точные пины),
  редакции четырёх проектов в `docs/compatibility.md` и
  `tests/contracts/baseline.json`.

## 1. Локальная финальная проверка (Linux)

```bash
npm ci                 # чистая установка
npm run typecheck      # типы во всех рабочих пространствах
npm test               # модульные тесты (Vitest)
npm run test:contracts # Kotlin ↔ TypeScript контракты
npm run package        # сборка пакета в apps/desktop/out
npm run test:desktop   # Electron-тесты по собранному приложению
# Производительность — отдельно и изолированно (в test:desktop он
# пропускается; бюджеты честны для железа выпуска):
GALLEY_PERF=1 npx playwright test tests/desktop/performance.spec.ts --workers=1
```

Дополнительно запустить собранный исполняемый файл вручную
(`apps/desktop/out/Galley Desk-linux-x64/Galley Desk`) и проверить открытие
книги, поиск, оформление, Zen и закрытие с сохранением. Результаты
зафиксировать в `docs/verification.md`.

## 2. Сборка дистрибутивов

```bash
npm run make --workspace @galley-desk/desktop
```

- Linux: ZIP-архив, `.deb` и `.rpm` (makers настроены в
  `apps/desktop/forge.config.ts`).
- macOS: ZIP-архив ( MakerZIP ограничен платформой `darwin`).

Артефакты появляются в `apps/desktop/out/make/…`.

## 3. Сборка на macOS

macOS-джоба в `.github/workflows/desktop.yml` выполняет `npm ci → typecheck
→ unit → Forge package → Electron tests` на нативном раннере. Ручные
проверки на macOS (IME, буфер обмена, нативный выбор папки, Cmd-акселераторы,
масштабирование) выполняются на реальной машине и фиксируются в
`docs/verification.md`; без них релиз помечается как «macOS: не проверено
вручную».

## 4. Подпись и нотаризация — НЕ ВЫПОЛНЕНО

У проекта нет сертификата Apple Developer ID и учётной записи нотаризации,
поэтому:

- `packagerConfig.osxSign` в `forge.config.ts` **не настроен** — приложение
  для macOS не подписано;
- нотаризация (Apple notarytool / `@electron/notarize`) **не выполняется**;
- `.deb`/`.rpm` подписываются только если окружение сборки имеет ключи —
  в текущем CI их нет, пакеты не подписаны.

Когда появятся учётные данные: добавить `osxSign`/`osxNotarize` в
`packagerConfig` (секреты `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` в CI), прогнать `codesign --verify --deep --strict` и
`spctl -a -v` на собранном `.app`, затем обновить этот раздел и
`docs/verification.md`. До этого момента заявления о подписанных сборках
недопустимы.

## 5. Тегирование и публикация

1. Зафиксировать в `docs/verification.md` фактические результаты прогона
   (дата, железо, числа производительности).
2. Создать тег `desktop-vX.Y.Z` на релизном коммите.
3. Приложить артефакты `npm run make` к релизу с явными пометками
   «unsigned» для macOS-сборок.
4. Обновить таблицу проверенных редакций в `docs/compatibility.md`, если
   менялись зависимости.

## A7: воспроизводимая проверка артефакта (Linux/macOS)

После `npm run package` задать **настоящий** executable:

```bash
# Linux
export GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/Galley Desk-linux-x64/Galley Desk"
# macOS: заменить arm64 на x64 для Intel
export GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/Galley Desk-darwin-arm64/Galley Desk.app/Contents/MacOS/Galley Desk"
npx playwright test tests/desktop/packaged-smoke.spec.ts --workers=1
npm run test:desktop -- --workers=1
```

Выбирать только строку своей платформы. Тест создаёт отдельные временные
книгу и профиль, регистрирует recent-запись и открывает её через UI. Он
запускает executable посредством `spawn` и подключается к **Chromium renderer
CDP** на loopback с временным портом. Node inspector и `electron.launch`
не используются, production fuses остаются включены. После сохранения тест
закрывает книгу (flush), завершает процесс, запускает вновь, применяет правку
и проверяет точное восстановление MD и sidecar через Undo. Нативный диалог
выбора папки этой автоматизацией не покрыт.

На Linux использовать DISPLAY/XAUTHORITY/GTK_MODULES **текущей** desktop
сессии. При запуске из изолированного shell значения можно посмотреть через
`systemctl --user show-environment`; не копировать чужой путь xauth. На
CachyOS/KDE в A7 требовалось унаследовать
`GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module`. Минимальный Electron
падал тем же образом без этого окружения; preload-хаков в продукте нет.

### Mac: обязательная ручная часть — пока not-run

На реальном Mac записать `sw_vers`, `uname -m`, `node --version`, commit SHA,
версию Electron и SHA256 `.app/Contents/MacOS/Galley Desk` и `app.asar`.
Собрать нативно, выполнить команды выше, затем на синтетической книге:

1. Открыть папку нативным picker; ввести замену, Cmd+Z, Cmd+Shift+Z,
   проверить восстановление и повторное открытие.
2. Быстро ввести 50 символов и сразу закрыть окно красной кнопкой; приложение
   должно остаться работающим. Через Dock открыть окно, сверить полный текст.
   Повторить Cmd+Q, запустить снова и сверить sidecar/source.
3. В системной японской IME набрать и подтвердить композицию, затем начать
   другую и отменить Escape; после сохранения/переоткрытия сверить текст.
4. Вставить из настоящего clipboard multiline, emoji и CRLF; проверить
   нормализованный ввод, неизменные исходные MD bytes до Apply и точный Undo.
5. Выполнить Apply/Undo и сравнить SHA256 обеих файлов до/после Undo.

`ControlOrMeta` в desktop-тестах использует Cmd на Mac; начало/конец
документа используют Meta+ArrowUp/Down. Chromium CDP composition test
проверяет commit/cancel, но не системную IME, candidate window или clipboard.
Linux native IME также остаётся not-run: ibus/fcitx5 на проверенной машине нет.
Без фактического Mac и Android roundtrip PASS весь platform gate открыт.

### ZIP без системного zip

В этой среде Forge ZIP maker завершился `spawn zip ENOENT`; deb/rpm tools
тоже отсутствуют. Допустим локальный portable ZIP каталога `out`, созданный
Python `zipfile` с UNIX permission bits и сохранением symlink entry. Это
**ручной portable ZIP**, а не успешный Forge make. Проверить `ZipFile.testzip`,
исполняемый бит бинарника и SHA256; подписанный релиз так не заявляется.
