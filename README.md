# Galley Desk

Приложение для Linux и macOS для рецензирования Markdown-книг. Пользователь открывает папку книги и редактирует текст; изменения сохраняются как правки в формате Pocket Editor. Отдельную правку можно вручную применить к Markdown или отклонить.

Стек: Electron, React, TypeScript и Galley Editor. Проект находится на стадии спецификации; исполняемого приложения пока нет.

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
