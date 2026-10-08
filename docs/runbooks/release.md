# Выпуск Galley Desk

## Модель выпуска

Как в Hieronymus: release-please поддерживает PR `chore: release X.Y.Z`;
**выпуск разрешает его ручное слияние в main**. Обычный PR и ручной запуск
Release Please только обновляют релизный PR. Автоматического слияния нет.
Теги имеют вид `vX.Y.Z`; прежняя рекомендация `desktop-vX.Y.Z` отменена.

`version.txt`, `apps/desktop/package.json`, запись приложения в lockfile и
`.release-please-manifest.json` обновляются вместе. Внутренние приватные
библиотеки сохраняют собственную версию: это не отдельные публичные релизы.
`npm run check:release` проверяет согласованность версий и релизные сценарии.

## Первое включение

1. Включить GitHub Actions и в Settings → Actions → General → Workflow permissions
   разрешить **Allow GitHub Actions to create and approve pull requests**.
   Workflow явно запрашивает необходимые права, повышать права всех workflow не нужно.
2. Слить изменения обвязки в `main`. Release Please создаст релизный PR на основе
   Conventional Commits (`feat`, `fix`, `perf`, `deps`, `build`). До 1.0 `feat`
   повышает minor, исправления — patch.
3. Проверить changelog, версию и результаты `Desktop`/`Contracts` на текущем HEAD
   релизного PR. PR от `GITHUB_TOKEN` не запускает `pull_request` автоматически,
   поэтому обвязка явно отправляет оба workflow на его ветку.
4. После готовности слить **релизный** PR. До этого теги и публичные релизы не создаются.

В Settings → Rules → Rulesets нужен активный tag ruleset для `v*`:
**Restrict updates** и **Restrict deletions**, без bypass actors. Создание тегов
остаётся разрешено workflow; изменение и удаление существующих тегов запрещены
на стороне GitHub, включая администраторов. Проверка SHA в скрипте дополняет
это правило, но сама по себе не защищает тег от force-push.

На 2026-10-08 GitHub API возвращает HTTP 403: для rulesets в этом приватном
репозитории требуется GitHub Pro либо публичная видимость. Поэтому защита тегов
пока **не включена**; до изменения тарифа/видимости гарантия на стороне платформы
отсутствует. Не считать локальные проверки SHA заменой ruleset.

## Что проверяет публикация

`release-please.yml` обнаруживает изменение версии и проверяет, что это точный
merge-коммит релизного PR в main того же репозитория. Повторный запуск использует
тот же immutable tag; перенос существующего тега запрещён.

`release.yml` собирает четыре нативные цели:

| Runner | Артефакты |
| --- | --- |
| Ubuntu 22.04 x64 | ZIP, deb, rpm, pacman `.pkg.tar.zst` через Arch container |
| Ubuntu 24.04 ARM64 | ZIP, deb, rpm |
| macOS 15 Intel | ZIP |
| macOS 15 Apple Silicon | ZIP |

Каждая цель проходит чистый `npm ci`, проверку версий, `npm audit`, TypeScript,
unit-тесты и Forge make. Linux также проверяет установку из ZIP и устанавливает
полученный deb и проверяет приложение из `/usr/lib/galley-desk` под Xvfb/Openbox,
включая SUID sandbox. Pocket Editor проверяется отдельной обязательной джобой
по SHA из `tests/contracts/baseline.json`.

Публикация начинается только после всех джоб: проверяет точный набор девяти
пакетов, добавляет `install.sh` и `SHA256SUMS`, загружает их в draft, скачивает
обратно и сравнивает байты. Только затем draft становится публичным Latest.
Ссылка для установки: [docs/installation.md](../installation.md).

Пакет pacman создаётся штатным `makepkg` из того же собранного приложения,
без повторной компиляции или strip Electron. Закреплённый по digest Arch image
собирает пакет от обычного пользователя, выполняет настоящий `pacman -U`,
проверяет файлы и sandbox, запускает installed smoke под Xvfb и удаляет пакет
через `pacman -R`. Этот gate выполняется и в PR workflow `Desktop`.
Для локальной репетиции после `npm run package`: `scripts/release/check-arch.sh`
(нужен Docker). На Arch можно только собрать пакет без установки:
`scripts/release/make-arch.sh`. Формат pacman пока только x86_64.

macOS не подписан Developer ID и не нотарифицирован. deb/rpm также не подписаны.
Нативные GUI/IME/picker/clipboard проверки macOS — **NOT RUN**. Это явно указано
в release notes. Секреты Apple отсутствуют, добавлять фиктивную подпись нельзя.

## Повтор неудачного выпуска

Используйте **Re-run failed jobs** исходного запуска, чтобы сохранить уже
проверенные артефакты. Либо запустите `Binary Release` вручную с существующим
`vX.Y.Z`: checkout берётся с тега, проверяется исходный merge-коммит и ancestry
main. Если запуск потерян до создания тега, укажите также `sha` — точный
merge SHA релизного PR; workflow проверит его принадлежность main, PR и версию.
Не используйте SHA обычного исправления. Это заново собирает кандидаты, но не заменяет уже опубликованные файлы.
Незавершённый draft можно дозаполнить; опубликованный релиз остаётся неизменным.
Не переносите тег на исправленный коммит: для изменения приложения нужен новый
релизный PR и номер версии.

После публикации проверьте Downloads и установку из публичного URL на чистой
машине. При первом включении дополнительно проверьте, что Actions разрешено
создавать PR, все четыре runner доступны, release PR получил оба ручных CI-прогона.

## Локальная проверка

Нужен Node >=22.13 (CI использует Node 24), npm; для deb — dpkg/fakeroot,
для rpm — rpmbuild, для ZIP — zip. Linux GUI-проверки требуют Xvfb/Openbox,
xdotool и xprop. Все команды из корня:

```sh
npm ci
npm run check:release
npm audit
npm run typecheck
npm test
npm run test:contracts
npm run make
GALLEY_PACKAGED_EXECUTABLE="$PWD/apps/desktop/out/galley-desk-linux-x64/galley-desk" \
  scripts/gui-test.sh npm run test:desktop -- --workers=1
```

`npm ci` явно скачивает Electron через `postinstall`; его новый npm-пакет больше
не выполняет это самостоятельно. При ошибке сети повторите `npm run postinstall`.
Не считайте сетевую ошибку успешным аудитом или успешно установленным Electron.

Никогда не запускайте GUI на текущем физическом DISPLAY. Если Xvfb недоступен,
GUI = **NOT RUN**. Не используйте `--no-sandbox`. Если host запрещает user namespaces,
проверяйте установленный системный пакет или отдельную root-owned копию с
`chrome-sandbox` root:root/4755. Для явной проверки fallback тестовая переменная
`GALLEY_TEST_FORCE_SUID_SANDBOX=1` включает `--disable-namespace-sandbox`.

Performance проверяется отдельно на выделенном железе:

```sh
GALLEY_PERF=1 scripts/gui-test.sh npx playwright test tests/desktop/performance.spec.ts --workers=1
```

Используются только временные книги и профили. Результаты и ограничения
фиксируются в [протоколе](../verification.md). Упаковка сама по себе не является
публикацией; локальные команды выше ничего не публикуют.
