# Протокол верификации настольного приложения

> **A7, 2026-09-16:** Linux executable и performance проверены на свежей сборке. Android folder roundtrip выявил blocker sidecar discovery. Реальный Mac и системная IME не проверены. Общий platform gate открыт; исторический аудит не заменяет результаты ниже.

Фактические результаты финальной проверки задачи D5 (поиск, оформление,
итоговая проверка packaged-приложений). Принцип: записывается только то,
что реально выполнено; непроверенное помечено явно.

Дата последнего прогона: **2026-09-15/16** (коммиты фиксируются в git).

## Companion-проверка A6 (2026-09-16)

Изолированные исходники Editor `4da44fcc1290381a8c9bbfdffcdb349dd68494cf`
(база `e5769b6`) и Pad `b78f22f27f00a98479369c6a18170e5d12aeb5c1`
(база `6f8cfff`) проверены следующими командами:

| Команда | Результат |
| --- | --- |
| Editor `npm test` | 526 passed |
| Editor `npm run test --workspace @inkyquill/galley-themes` | 11 passed |
| Editor `npm run lint` | PASS |
| Editor `npm run test:package-consumer` | 1 passed; реальные tarballs, runtime/types/CSS |
| Editor `npm run docs:build` | PASS, 19 страниц |
| Editor `npm run build-storybook` | PASS |
| Pad `mise run verify` | PASS: audit `{}`, 275 unit, 20 scripts, 19 integration, frontend build, Rust fmt, 40 Rust tests, Tauri info и debug build |
| npm `0.14.0`, отдельный consumer-прогон | 1 passed; тот же consumer test с `npm pack <package>@0.14.0` вместо `--workspace` |

Editor: два обычных baseline-прогона прошли; воспроизведение истечения
20ms бюджета начального парсинга через управляемый `Date.now` вернуло
525 pass / 1 fail в полном suite и 14 pass / 1 fail в focused-файле.
`forceParsing` в test helper обеспечивает готовое дерево: исходные ожидания
`normalizeTable === true` и точный Markdown сохранены, production-команда
не менялась. С детерминированным сценарием итоговый suite зелёный.

Pad: window capture намеренно отменяет `mousedown`/`auxclick` с button=1
во всём окне, включая tabstrip, чтобы отпускание после сдвига табов не
вставляло Linux primary selection. Исправлено устаревшее ожидание теста;
реальные middle-close сценарии также прошли. Production handler сохранён.
Audit исправлен совместимыми patch/minor-обновлениями Vitest/mocker `4.1.11`, js-yaml `4.3.2`,
nanoid `3.3.19`, postcss `8.5.28`, undici `6.28.1`/`7.29.1` в существующих
совместимых диапазонах; audit не отключался.

Ограничения: после успешного полного gate один запуск pre-commit Pad выявил
интермиттирующий тест Save As (`document.title` ещё `* Untitled.md` вместо
`new.md`); focused-повтор и полный pre-commit под `mise exec` прошли.
Этот тест не менялся; единичный сбой сохранён как риск стабильности suite.
Есть предупреждения Node experimental localStorage, Playwright color env и
Vite/Storybook о размере bundle и Storybook module.register deprecation; ошибок сборки нет. Это Linux-проверка,
macOS и бинарные релизы companion-приложений здесь не запускались.
Проверено не означает слито/выпущено: точные source pins и отдельный
статус опубликованных артефактов — в [compatibility.md](compatibility.md).

## A7: свежая проверка 2026-09-16

База Desk `d30237cefd13fe84d8b4a0cc2c72ba537aceee00`; production fix A7
`872a80a` восстанавливает фокус после Escape через CodeMirror API, сохраняя выделение.
Pocket база `f3012aa8abb73cda32b943ff74f5b78039300d8f`, новый opt-in harness
`f2d44a1` воспроизводит folder-level failure через production ReaderRepository.
Полные команды, результаты и SHA артефактов: [A7 report](reviews/2026-09-16-evidence/a7/report.md).

| Проверка | Результат |
| --- | --- |
| TypeScript / unit | PASS, 274 tests |
| Kotlin ↔ TS contracts | PASS, 21 cases; это не folder roundtrip |
| Forge package | PASS, Electron 44.4.0, production fuses включены |
| Packaged executable | PASS: изолированный профиль, UI open/save/restart/apply/byte-exact undo |
| Desktop suite | PASS: 44 passed, 1 perf skip; после fix первоначального Esc selection FAIL |
| Performance | PASS, ниже |
| Chromium CDP IME commit/cancel и multiline/emoji/CRLF | PASS; source CRLF bytes сохранены |
| Linux системная IME / настоящий clipboard | not-run; ibus/fcitx5 отсутствуют |
| Android connected suite (до нового harness) | PASS: 237 passed, 5 skipped, 0 failures; Pocket f3012aa |
| Android реальная загрузка переданной папки | **FAIL**: chapter_note ожидается, Reader возвращает null |
| Реальный macOS packaged/manual | **not-run**, имеется только Linux; инструкция подготовлена |
| GitHub CI dispatch / подпись / notarization | not-run |

### Машина и performance

CachyOS rolling, kernel 7.2.4-3-cachyos x86_64, glibc 2.44; Ryzen 7 5800X,
MemTotal 65,741,008 kB; Node 26.2.0, npm 11.13.0, Electron 44.4.0.
Один performance worker, без параллельного Electron suite; Android emulator
оставался запущен в этой desktop-сессии. Машина не была
изолирована от всех фоновых процессов, числа не являются гарантией для CI.

Синтетическая книга: 100 глав; большая глава 1,048,645 UTF-8 bytes,
500 review records, 24 последовательных input samples.

| Метрика | Результат | Бюджет |
| --- | --- | --- |
| Запуск + открытие книги | 573 ms | нет |
| Открытие большой главы | 957 ms | ≤2000 ms |
| beforeinput → первая DOM mutation, median / p95 / max | 18.8 / 27.6 / 31 ms | p95 ≤50 ms |
| input dispatch → подтверждённое сохранение, p95 | 1033.0 ms | нет |
| RSS main / renderer heap | 432,361,472 / 29,400,000 bytes | фиксация |

[Все samples](reviews/2026-09-16-evidence/a7-performance-results.json) доступны в evidence
`reviews/2026-09-16-evidence/a7-performance-results.json`.
Метрика сохранения включает host keyboard dispatch, чтение sidecar,
реконструкцию точного текста движком и UI ack «Сохранено», включая overhead
polling. Это **не** измерение физического fsync. После опустошения очереди
через Close и reopen проверены точный полный текст и неизменность source bytes.
DOM mutation не означает ни сохранение, ни завершение paint.

### Реальные ограничения и диагностика

Linux SIGSEGV происходил и в минимальном Electron из-за GTK appmenu module
lifetime; воспроизведение и диагностика ранее выполнены контроллером.
Унаследованное KDE `GTK_MODULES=colorreload-gtk-module:appmenu-gtk-module`
устранило запуск. DISPLAY/XAUTHORITY взяты из текущей user-manager сессии;
production workaround или отключения fuses нет.

Packaged test использует Chromium renderer CDP, а обычные desktop tests —
`node_modules/electron` с Forge `.vite` entry. Оба пути реально проверены.
В packaged smoke recent-запись подготавливается в тестовом профиле; native
folder picker и native window close отдельно этим smoke не доказываются.

Pocket emulator-5554: Android 15 / API 35, sdk_gphone64_x86_64. Harness
копирует **только синтетическую** папку в offline cache, регистрирует её в
Room и вызывает production ReaderRepository.observeChapter. Файл
`chapter.review.json` остаётся под настоящим Desk именем. Reader ищет
`chapter.md.review.json`: chapter_note=null и записи не найдены.
Это fail реального app-layer discovery, несмотря на зелёные codec contracts.
SaveNote/return-to-Desk пока не достигнуты; копирование adb не засчитывается
как успех. Требуется совместимый canonical/legacy fix с защитой от коллизий.

Предупреждения сборки: три Vite native-config compatibility warnings,
inlineDynamicImports deprecation, bundle-size warnings. Первоначально был
NO_COLOR/FORCE_COLOR conflict; финальные запуски очищают обе переменные.
Forge make ZIP: FAIL (`spawn zip ENOENT`). ZIP создан отдельно Python с
permission bits/symlinks; deb/rpm не собраны. Release остаётся не завершён.
