# Galley Desk

Приложение для Linux и macOS для рецензирования Markdown-книг. Пользователь открывает папку книги и редактирует текст; изменения сохраняются как правки в формате Pocket Editor. Отдельную правку можно вручную применить к Markdown или отклонить.

Стек: Electron, React, TypeScript, Galley Editor и Galley Themes. Реализован полный настольный контур: открытие папок и недавних книг, редактирование с session Undo, сигналы и заметки главы, виды «Текст»/«Сравнение»/«Исходник», поиск по главе, фильтр оглавления, оформление (темы Galley, шрифт, ширина строки), режим Zen, упаковка Electron Forge и Electron-тесты по собранному приложению.

## Запуск и сборка

Команды выполняются из корня репозитория (Node 20+; проверено на Node 22 и Node 26):

- `npm ci` — установка зависимостей (workspaces).
- `npm start` — запустить приложение в режиме разработки (Electron Forge dev-сервер).
- `npm run package` — собрать и упаковать приложение для текущей платформы в `apps/desktop/out`; собранный исполняемый файл (`Galley Desk`) запускается напрямую.
- `npm run make --workspace @galley-desk/desktop` — дистрибутивы: Linux ZIP/deb/rpm, macOS ZIP (без подписи, см. `docs/runbooks/release.md`).
- `npm run test:desktop` — Playwright-тесты Electron-приложения, включая производительность; перед запуском нужен `npm run package`.
- `npm test` — модульные тесты пакетов (Vitest).
- `npm run test:contracts` — Kotlin ↔ TypeScript контракты с Pocket Editor (нужен JDK 17; детали в `docs/compatibility.md`).
- `npm run typecheck` — проверка типов во всех рабочих пространствах.

Пример реального запуска после сборки:

```bash
npm run package
"./apps/desktop/out/Galley Desk-linux-x64/Galley Desk"
```

Примечание: на Node 26 (и Node 24.16+) зависимость `extract-zip` из `@electron/packager` перестаёт работать; в корневом `package.json` она переопределена на официальный форк `@electron-internal/extract-zip`.

## Документация

- [Руководство пользователя](docs/user-guide.md) — поиск, оформление, Zen, недоступные записи, ошибки записи, передача папки.
- [Протокол верификации](docs/verification.md) — что и где проверялось, железо, производительность, явно непроверенное.
- [Runbook выпуска](docs/runbooks/release.md) — сборка дистрибутивов; подпись/нотаризация описаны и не выполнялись.
- [Спецификация первой версии](docs/superpowers/specs/2026-09-15-galley-desk-design.md)
- [Контекст и словарь](CONTEXT.md)
- [Недоступные привязки](docs/adr/0001-no-manual-anchor-rebinding-in-v1.md)
- [Граница Galley Editor](docs/adr/0002-galley-editor-generality-boundary.md)
- [Общий пакет тем](docs/adr/0003-shared-theme-package.md)

## План реализации

[Порядок работ и четыре подробных плана](docs/superpowers/plans/2026-09-15-galley-desk-implementation.md) — 18 задач с интерфейсами, проверками и критериями готовности.

## Связанные проекты

Реализация включает необходимые изменения Pocket Editor, Galley Editor и Galley Pad в их отдельных репозиториях; проверенные редакции перечислены в [docs/compatibility.md](docs/compatibility.md). Совместимость с недоступными и конфликтующими правками требует обновлённого Pocket Editor; существующие старые версии могут отвергать такие файлы.
