# Проверки безопасности Electron

## Electronegativity

`npm run check:security` сканирует собственные TS/TSX и `index.html` с CSP. Временная копия сохраняет пути относительно репозитория; сборки, зависимости, тестовые книги и пользовательские файлы в неё не попадают. Версия Electron берётся из desktop package.json. Никакие правила не отключены.

Выходные файлы: `test-results/security/electronegativity.json` и `.sarif`. Linux CI запускает проверку и сохраняет оба файла как artifact `electron-security`. Ошибка запуска/парсинга завершает команду неуспешно. Находки пока отчётные: нулевой exit code означает завершённый анализ, а не отсутствие уязвимостей.

[Electronegativity 1.10.3](https://github.com/doyensec/electronegativity) больше не поддерживается авторами. Его база версий Electron и некоторые эвристики устарели. Инструмент делает сетевые запросы за переводами и списком версий; предупреждение о недоступном переводе не означает, что TS/TSX не разобран. Сканер не заменяет Electron security tests, npm audit и ревью IPC/ресурсного протокола. Dev-зависимость не включается в runtime приложения.

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
