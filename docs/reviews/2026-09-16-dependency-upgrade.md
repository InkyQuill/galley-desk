# React 19, Vite для Forge и Electronegativity

Код: `0ec6250`, ветка `codex/desk-visual-redesign`. Без push/публикации.

## Изменения

- React/react-dom и типы: 19.3.0 в Desktop и prototype. Одна копия React для Galley Editor, Tabler и приложения; раздельные React18/19 воспроизводимо ломали рендеринг иконок.
- Desktop и корневой build host: Vite7.3.6 вместо5.4.21. Корневой pin нужен, поскольку Forge plugin импортирует Vite из своей позиции в дереве workspace. Прототип сохраняет Vite8.3.0. Forge7.11.2 уже актуальный, его версия не меняется.
- Node engines: `^20.19.0 || >=22.12.0`.
- Electronegativity1.10.3, команда `npm run check:security`, JSON/SARIF и Linux CI artifact. Сканируются собственные TS/TSX и HTML с CSP; ошибки разбора проваливают команду, находки требуют ручного разбора. [Подробности и пять оставшихся находок](../../security.md).
- Явно запрещены браузерные разрешения на session; Electron-тест проверяет отказ Notification.requestPermission.
- CI Linux/macOS теперь передаёт путь к реальному packaged executable; macOS путь определяется по архитектуре runner. Сам Mac локально не запускался.
- ZIP собирается штатным Forge maker. Пользователь установил zip; системный Xvfb установлен через pacman с его разрешения.

Основание: [предоставленный шаблон](https://github.com/verylovestars/electron-blazing-template/blob/main/package.json) использует React19/Vite7. При сравнении Vite8/Vite7 dev-запуск упирался в недоступный IPv6 localhost: TCP к `::1` зависал. `server.host: '127.0.0.1'` устранил проблему. Это не доказательство несовместимости Vite8 с Forge; для Desktop выбран7.3.6, без патчей Forge.

## Регрессии, обнаруженные проверкой

1. При обновлении lockfile npm вернул старый extract-zip2.0.1 в цепочку Packager. На Node26 упаковка прекращалась без executable. Официальный drop-in fork закреплён явным dev alias и override; устаревшая вложенная запись удалена из lockfile. Проверена чистая `npm ci`, фактическое разрешение зависимости, создание executable и его запуск. Forge fuses сохранены.
2. React19 выявил гонку: после ack новой ревизии отложенный эффект старого snapshot видел пустую очередь и заменял уже подтверждённый текст. Snapshot с revision ниже expectedRevision теперь игнорируется. Исходный быстрый ввод без изменения ожиданий: **3/3 RED → 3/3 GREEN**. Сохранены логи воспроизведения. Никаких задержек или ослабления проверок не добавлено.
3. При переразмещении Vite npm попытался загрузить отсутствующий tarball rolldown1.2.9. В lockfile сохранён уже используемый совместимый1.2.8 и его bindings; чистая npm ci проходит. Принудительных major overrides Rolldown нет.

## Проверка

| Проверка на0ec6250 | Результат |
| --- | --- |
| npm ci / dependency tree | PASS; React19.3.0 единственный, Forge импортирует Vite7.3.6, Packager — официальный extract-zip fork |
| typecheck | PASS |
| unit | 314 passed, 27 files |
| prototype build | PASS |
| Forge package | PASS, executable существует |
| Electron suite с packaged executable | 54 passed, 1 opt-in performance skipped |
| Отдельный performance | PASS: открытие1MiB/500records главы970ms ≤2000, input→DOMp95 29.4ms ≤50 |
| Forge dev | PASS: настоящее окно на HTTP Vite URL, require недоступен |
| Electronegativity | 36 atomic / 6 global; 5 находок; 0 parser errors |
| Workflow YAML / diff check | PASS |

[Evidence](2026-09-16-evidence/dependency-upgrade/) содержит команды/логи, RED→GREEN, дерево зависимостей, JSON/SARIF и samples производительности. Linux/CachyOS, Node26.2.0, системный Xvfb; реальные GUI-прогоны последовательны. Нативная macOS и системная IME не проверялись; CI-конфигурация подготовлена, удалённый запуск не выполнялся.

npm audit: 28 advisory в дереве (3low,24high,1critical); это число транзитивных пакетов с advisory, не число подтверждённых уязвимостей приложения. Сканер отсутствует в packaged ASAR. `npm audit` не чистый: транзитивные advisory инструментов Forge/сканера остаются, это отдельная работа. Electronegativity больше не поддерживается авторами и не заменяет аудит зависимостей.

## Артефакт

Штатный `npm run make --workspace @galley-desk/desktop -- --skip-package --targets=@electron-forge/maker-zip` создаёт `apps/desktop/out/make/zip/linux/x64/Galley Desk-linux-x64-0.1.0.zip` из проверенного package. [SHA256](2026-09-16-evidence/dependency-upgrade/artifact-sha256.txt). Отдельный запуск после распаковки ZIP не выполнялся; исходный packaged executable прошёл smoke/roundtrip.
