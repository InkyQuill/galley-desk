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
(`apps/desktop/out/galley-desk-linux-x64/galley-desk`) и проверить открытие
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
→ unit → Forge package` на нативном раннере. GUI-тесты macOS — **NOT RUN**:
обвязка поддерживает изоляцию только через Linux/Xvfb. Ручные
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
export GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk"
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
6. Проверить новую рамку: traffic lights не перекрывают содержимое;
   перетаскивание, полноэкранный режим и выход из него, системное меню
   и Cmd+Z/Cmd+Shift+Z работают. Иконка видна в Dock и пакете приложения.
7. Проверить метаданные и управление главами на временной книге: изменение
   title, создание, добавление существующего файла, удаление из оглавления
   и повторное добавление с сохранёнными сигналами, перенос файлов в корзину.

`ControlOrMeta` в desktop-тестах использует Cmd на Mac; начало/конец
документа используют Meta+ArrowUp/Down. Chromium CDP composition test
проверяет commit/cancel, но не системную IME, candidate window или clipboard.
Linux native IME также остаётся not-run: ibus/fcitx5 на проверенной машине нет.
Без фактического Mac и Android roundtrip PASS весь platform gate открыт.

### Linux ZIP

Для штатного ZIP maker нужен системный `zip` (на Arch/CachyOS: `sudo pacman -S zip`).
После успешного `npm run package`:

```bash
npm run make --workspace @galley-desk/desktop -- --skip-package --targets=@electron-forge/maker-zip
```

Артефакт появляется в `apps/desktop/out/make/zip/linux/x64/`.
Ранее отсутствие `zip` приводило к `spawn zip ENOENT`; теперь пакет установлен,
и используется штатный Forge maker. deb/rpm требуют собственных системных
инструментов и не входят в эту команду.


### Headless Linux: проверка собственной рамки

Для X11-сценариев нужны `Xvfb`, Openbox, `xdotool` и `xprop` (в Arch:
`xorg-server-xvfb openbox xdotool xorg-xprop`). Запускайте WM только внутри
изолированного дисплея; рабочую KDE-сессию менять не требуется:

```bash
export GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk"
xvfb-run -a sh -c '
  openbox >/tmp/galley-test-openbox.log 2>&1 &
  galley_wm_pid=$!
  trap "kill $galley_wm_pid 2>/dev/null || true" EXIT
  npm run test:desktop -- --workers=1
'
```

На проверенной CachyOS перед `xvfb-run` добавлялось:
`env -u XAUTHORITY -u WAYLAND_DISPLAY -u NO_COLOR -u FORCE_COLOR GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module`.
Не запускайте Openbox с DISPLAY вашей рабочей сессии.

Тесты настоящей корзины используют одноразовые каталоги в `~/.cache`:
перенос из `/tmp` на внутреннем tmpfs может быть запрещён системным gio.
Передача `GALLEY_PACKAGED_EXECUTABLE` включает проверки настоящего
упакованного приложения; Linux X11-проверки не заменяют ручные Mac-пункты.

### Linux: SUID sandbox и пробелы в пути установки

Linux-пакет называется `galley-desk-linux-x64`, executable — `galley-desk`.
Название приложения в интерфейсе остаётся **Galley Desk**; macOS-пакет не переименован.
Если система использует SUID fallback Chromium вместо user namespaces, путь
установки приложения (включая родительские каталоги) должен быть без пробелов.
Это ограничение не относится к каталогам книг.

Причина в Chromium: [SetuidSandboxHost::PrependWrapper](https://chromium.googlesource.com/chromium/src/+/main/sandbox/linux/suid/client/setuid_sandbox_host.cc)
передаёт путь helper без кавычек, а [CommandLine::PrependWrapper](https://chromium.googlesource.com/chromium/src/+/main/base/command_line.cc)
разбивает его по пробелам. На Electron 44.4.0 воспроизведено с временной копией
приложения и корректным root:root/4755 helper: каталог `with space` даёт
`execvp: .../with` и exit 133; переименование только каталога в `no-spaces`
позволяет запустить sandbox и получить CDP endpoint.

В CI packaged-тесты явно выбирают SUID fallback, не отключая sandbox:

```sh
sandbox="$PWD/apps/desktop/out/galley-desk-linux-x64/chrome-sandbox"
sudo chown root:root "$sandbox"
sudo chmod 4755 "$sandbox"
export GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk"
export GALLEY_TEST_FORCE_SUID_SANDBOX=1
# Затем обычный headless-прогон с Xvfb/Openbox, описанный выше.
```

`GALLEY_TEST_FORCE_SUID_SANDBOX` читается только тестовым launcher и передаёт
`--disable-namespace-sandbox`, заставляя Chromium использовать SUID sandbox.
Ни `--no-sandbox`, ни отключение renderer sandbox не используются. Для локальной
проверки лучше делать отдельную временную копию пакета и удалять её после теста.
