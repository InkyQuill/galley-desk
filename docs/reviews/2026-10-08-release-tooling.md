# Обвязка выпуска Galley Desk — 2026-10-08

Проверено на базе `5de5ae7` с локальными изменениями этой задачи. Версия
репетиционного приложения — **0.1.0**; тег, коммит, PR и публичный релиз
при первоначальной репетиции не создавались. Готовые Linux x64 файлы лежат в `release-assets/`
(игнорируются Git). Они не объявляются опубликованным релизом.

## Решения

- Модель Hieronymus: release-please поддерживает `chore: release X.Y.Z`,
  ручное слияние разрешает выпуск. `version.txt` согласован с runtime manifest,
  lockfile и release-please manifest. Теги `vX.Y.Z`.
- Проверяются точный merge SHA релизного PR, тот же репозиторий, main ancestry
  и неизменность тега. Bot PR получает явные dispatch `Desktop` и `Contracts`.
- Нативная матрица: Linux x64/ARM64 ZIP/deb/rpm, macOS Intel/Apple Silicon ZIP.
  После всех gates проверяется полный набор файлов, формируется SHA256SUMS,
  draft скачивается обратно и сверяется до публикации. Повтор не заменяет
  опубликованные бинарники.
- Linux-установщик: checksum, закрепление версии при скачивании, проверка ZIP
  entries/верхнего каталога, `/opt/galley-desk`, атомарное переключение `current`,
  сохранение прежней установки, пункт меню и команда, sandbox root:root/4755.
  Поддерживаются явная версия, скачивание без установки и офлайн-установка.
- Electronegativity удалён по решению пользователя: upstream больше не поддерживает
  проект, прямой поддерживаемой бесплатной замены для этого CI не найдено.
  Не добавлены фиктивные SAST-проверки и исключения npm audit.
- Разрешение GitHub Actions создавать PR включено и повторно прочитано:
  `default_workflow_permissions=read`, `can_approve_pull_request_reviews=true`.
  Код workflow ещё необходимо доставить в main.

## Зависимости

Electron 44.7.0, Forge 8.0.1, Galley Editor/themes 0.16.0, TypeScript 7.0.2,
Vite 8.3.3, Vitest 5.0.3, Playwright 1.64.0 и остальные обновления закреплены
в manifests/lockfile. `npm outdated --json` вернул `{}`.
Минимальный Node теперь 22.13; CI использует Node 24.

Forge 8 изменил имя main bundle на `main.cjs`; manifest обновлён. TypeScript 7
проверяет side-effect CSS imports, добавлена декларация стилей. Electron теперь
явно устанавливается корневым postinstall. Старый extract-zip override и неиспользуемый
plugin-auto-unpack-natives удалены. Временных overrides сканера не осталось.

Baseline редактора обновлён на npm gitHead
`54808abce1898f5ad74c204f8c3ed84750382116` (одинаков для editor/themes).
Pocket SHA не менялся; CI теперь читает его из baseline вместо расходившегося
второго пина. Схемы и фикстуры формата не менялись.

## Фактическая проверка

| Проверка | Результат |
| --- | --- |
| Чистый `npm ci` с postinstall | PASS |
| `npm audit` всего дерева | **0 уязвимостей**; исходно 46, включая 1 critical |
| `npm outdated --json` | `{}` |
| TypeScript | PASS |
| Unit | 487 PASS, 37 файлов |
| Kotlin ↔ TypeScript | PASS, 21 exchange-тест |
| Forge package | PASS, Linux x64 |
| Полный Electron/Xvfb/Openbox | **122 PASS**, 1 штатный performance skip |
| Forge make | PASS: ZIP, deb, rpm; makers выполнены в Debian/Node 24 container |
| Установка deb через apt | PASS в чистом Debian 12 container |
| Установленный deb, SUID sandbox | **3 PASS**: save/restart/apply/byte-exact Undo, renderer isolation, navigation |
| ZIP installer, повторная установка | PASS; прежний каталог сохранён, launcher/icon/menu существуют |
| Установленный ZIP, SUID sandbox | **3 PASS**, те же сценарии |
| RPM | Пакет собран, inventory и postinstall проверены; установка в Fedora **NOT RUN** |
| Обвязка выпуска | 6 PASS; порча скачанных release bytes блокирует публикацию |
| Release Please, публичная factory API | `fix → 0.1.1`, `feat` и `feat! → 0.2.0`; title и оба JSON updater проверены |
| actionlint 1.7.12 + ShellCheck | PASS |
| `git diff --check` | PASS |
| macOS / Linux ARM64 сборки | **NOT RUN локально**, настроены нативные CI jobs |
| macOS GUI/IME/picker/clipboard/signing/notarization | **NOT RUN** |
| Публикация и скачивание с публичного release URL | **NOT RUN**, нет опубликованного релиза |

GUI запускался только в изолированном Xvfb/Openbox с временными книгами и
профилями. Установленные приложения проверены от пользователя `node` внутри
одноразовых контейнеров; для Chromium namespaces контейнерам даны SYS_ADMIN
и unconfined seccomp, при этом renderer/SUID sandbox не отключались. Физический
дисплей и реальные книги не использовались. Хостовая установка не менялась.

Проверка установки выявила и исправила ожидание неверного корня Forge ZIP.
Повтор после исправления прошёл. Сетевые сбои скачивания Electron/индексов Debian
не считались успешными проверками: бинарник Electron сверялся с официальным
checksum, установка затем повторена успешно; Debian-репетиция использовала HTTPS.

[Evidence](evidence/release-tooling-2026-10-08/): итоговый npm audit, release tests,
репетиция release-please, логи установленных ZIP/deb, RPM postinstall и SHA256SUMS
локальных Linux x64 кандидатов. Остальные бинарные цели необходимо подтвердить
на GitHub при первом выпуске. Инструкции: [установка](../installation.md),
[выпуск](../runbooks/release.md).

## Дополнение: пакет pacman и подготовка PR

По запросу пользователя добавлен `galley-desk-VERSION-1-x86_64.pkg.tar.zst`.
Настоящий makepkg формирует `.PKGINFO`, `.BUILDINFO`, `.MTREE`, список runtime
зависимостей, меню и root-owned SUID helper. Strip и debug-split отключены,
чтобы не модифицировать готовые Electron binaries. Каталог приложения явно
получает 755: первая проверка выявила унаследованные от Forge права 700,
исправление подтверждено повторным запуском.

Чистый Arch container (официальный image закреплён digest) успешно выполнил:
сборку → pacman -U с разрешением зависимостей → pacman -Qkk (96 файлов,
0 изменений) → 3 installed smoke/Xvfb теста с SUID sandbox → pacman -R.
Arch ARM64 не заявлен. Pacman-пакет включён в строгий список артефактов:
всего девять пакетов, install.sh и SHA256SUMS. PR workflow сохраняет его
как artifact `pacman-package`; публикация по-прежнему только после release PR.

Обвязка PR изолирована от трёх неотправленных локальных коммитов с документацией
и дизайном. База PR: `d235f99fa7520c0eabf8c56ba565c932dc55bdfe`; исходная рабочая копия сохранена.
В изолированной копии повторно прошли чистый npm ci, Forge package,
487 unit-тестов, typecheck, 6 release-тестов, npm audit (0), actionlint,
ShellCheck и diff --check. Изменений кода приложения относительно предыдущего
полного desktop-прогона нет, кроме уже проверенной декларации CSS imports.

[Проверка pacman](evidence/release-tooling-2026-10-08/installed-arch.txt).
