# Проверки безопасности Galley Desk

## Действующие проверки

- `npm audit` — все runtime- и dev-зависимости; CI и публикация останавливаются при любой известной уязвимости.
- `npm test` — в том числе `ipc.test.ts`, `window.test.ts`, `resources.test.ts`: проверка sender/аргументов IPC, закрытого набора протоколов и безопасных настроек окна.
- `scripts/gui-test.sh npm run test:desktop -- --workers=1` после упаковки — настоящие Electron-сценарии: недоступность Node в renderer, блокировка навигации/разрешений и внешние ссылки.
- Релизные Linux-тесты запускают установленный deb с настоящим SUID sandbox; `--no-sandbox` запрещён. Forge fuses запрещают RunAsNode, NODE_OPTIONS и Node inspector, включают ASAR integrity и OnlyLoadAppFromAsar.

Изменения preload/main требуют ревью границ доверия по [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security).
Аудит зависимостей и тесты конкретных инвариантов не гарантируют отсутствие всех уязвимостей и не заменяют полный SAST.

## Удаление Electronegativity — 2026-10-08

Авторы [больше не поддерживают Electronegativity](https://github.com/doyensec/electronegativity),
а Electron [удалил рекомендацию сканера](https://github.com/electron/electron/pull/48878).
Поддерживаемая бесплатная прямая замена для нашего CLI/CI-процесса не найдена.
Общие SAST-системы требуют отдельного набора правил и не являются прямой заменой.
По решению пользователя удалены пакет, скрипт, CI-шаг и временные dependency overrides.
Прежние отчёты сохранены как исторические свидетельства, а не текущий security gate.

## Исторические результаты (сканер больше не запускается)

## Разбор 2026-09-16

Выполнены 36 atomic и 6 global checks, ошибок разбора нет. После исправления разрешений осталось 5 находок, без High/Critical. Они сохранены в отчёте и не заглушены.

| Правило | Разбор |
| --- | --- |
| PERMISSION_REQUEST_HANDLER | Исправлено: session явно отклоняет запросы и проверки браузерных разрешений. Electron-тест проверяет отказ Notification.requestPermission. |
| CSP_GLOBAL_CHECK (Low) | CSP evaluator указывает на `script-src 'self'`: общий риск размещения JSONP/пользовательского JS на том же origin. Здесь скрипты принадлежат сборке; книги не публикуются в origin renderer, изображения идут через отдельный ограниченный протокол. Inline/eval-скрипты запрещены. |
| AUXCLICK_JS_CHECK (Medium) | Все новые окна отклоняются setWindowOpenHandler; will-navigate ограничен origin приложения. Старый сканер не распознаёт эту защиту. |
| PRELOAD_JS_CHECK (Medium) | Нужен typed bridge для локальных файлов. Sandbox и contextIsolation включены, nodeIntegration выключен; произвольного Electron/Node API renderer не получает. |
| OPEN_EXTERNAL_JS_CHECK ×2 (Medium) | Renderer вызывает typed IPC; main проверяет sender и пропускает только http(s) через openExternalVia. Исполняемые/локальные протоколы отклоняются. Существующие unit/Electron tests проверяют эти ограничения. |

npm audit — отдельная проверка дерева зависимостей. Оно не объявляется чистым: остаются advisory в цепочках инструментов Forge и старого сканера, включая tar. Принудительное понижение Forge или замена major транзитивных пакетов без проверки в это обновление не входят.

## После исправлений реальных книг, 2026-09-16

На `21ce42d` сканер завершил 36 atomic/6 global проверок без ошибок разбора
и выдал **6 находок**, включая High `CONTEXT_ISOLATION_JS_CHECK` и Medium
`SANDBOX_JS_CHECK`. Это отличается от исторического набора из пяти выше:
параметры BrowserWindow перенесены в `buildMainWindowOptions`, вызов которой
старый анализатор не раскрывает. `PRELOAD_JS_CHECK` больше не появляется.

Проверены и код функции, и фактические `webContents.getLastWebPreferences()`
созданного Electron-окна: `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`. Нативные тесты также проверяют отсутствие `require`,
отказ разрешений и блокировку навигации. Правила не подавлялись. Оставшиеся
CSP/AUXCLICK/два OPEN_EXTERNAL имеют тот же разбор, что выше.
[JSON/SARIF и runtime evidence](docs/reviews/evidence/real-book-fixes/).

Финальный повтор на `48246d4`: те же 6 находок, 0 ошибок разбора.
[Финальный JSON/SARIF](docs/reviews/evidence/real-book-fixes/final/security/).
