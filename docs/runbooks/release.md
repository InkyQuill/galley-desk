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
