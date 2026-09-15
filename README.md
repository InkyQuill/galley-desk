# Galley Desk

Приложение для Linux и macOS для рецензирования Markdown-книг. Пользователь открывает папку книги и редактирует текст; изменения сохраняются как правки в формате Pocket Editor. Отдельную правку можно вручную применить к Markdown или отклонить.

Стек: Electron, React, TypeScript и Galley Editor. Текущая стадия: настольная оболочка запускается — изолированное окно Electron (React-рендерер с заглушкой, контекст изолирован, sandbox включён), сборка и упаковка через Electron Forge работают. Работа с книгами (открытие папки, правки, сигналы) добавляется следующими задачами плана.

## Запуск и сборка

Команды выполняются из корня репозитория (Node 20+):

- `npm start` — запустить приложение в режиме разработки (Electron Forge dev-сервер).
- `npm run package` — собрать и упаковать приложение для текущей платформы в `apps/desktop/out`.
- `npm run test:desktop` — Playwright-тесты Electron-оболочки (перед запуском нужен `npm run package`).
- `npm test` — модульные тесты пакетов (Vitest).
- `npm run typecheck` — проверка типов во всех рабочих пространствах.

Примечание: на Node 26 (и Node 24.16+) зависимость `extract-zip` из `@electron/packager` перестаёт работать; в корневом `package.json` она переопределена на официальный форк `@electron-internal/extract-zip`.

## Документация

- [Спецификация первой версии](docs/superpowers/specs/2026-09-15-galley-desk-design.md)
- [Контекст и словарь](CONTEXT.md)
- [Недоступные привязки](docs/adr/0001-no-manual-anchor-rebinding-in-v1.md)
- [Граница Galley Editor](docs/adr/0002-galley-editor-generality-boundary.md)
- [Общий пакет тем](docs/adr/0003-shared-theme-package.md)

## План реализации

[Порядок работ и четыре подробных плана](docs/superpowers/plans/2026-09-15-galley-desk-implementation.md) — 18 задач с интерфейсами, проверками и критериями готовности.

## Связанные проекты

Реализация включает необходимые изменения Pocket Editor, Galley Editor и Galley Pad в их отдельных репозиториях. Совместимость с недоступными и конфликтующими правками требует обновлённого Pocket Editor; существующие старые версии могут отвергать такие файлы.
