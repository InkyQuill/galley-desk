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

## A7: итоговая проверка совместимости папок 2026-09-16

**Linux и Android folder compatibility PASS; общий platform gate открыт:**
реального macOS и системной Linux IME на этой машине нет. Их пункты остаются
not-run; подготовка к Mac запуску не считается выполнением.

Desk production fixes: `872a80a` (Esc selection), `bb332c1` (canonical/legacy
sidecar resolver и recovery). Pocket: `002f609818b913db66680320da198d7eb7c972c6`. Проверялся новый
Forge package с production fuses; [SHA256](reviews/2026-09-16-evidence/a7-compat/artifact-sha256.txt).
Полные команды, RED→GREEN и ограничения: [A7 compatibility report](reviews/2026-09-16-evidence/a7-compat/report.md).
[Первоначальный A7 отчёт](reviews/2026-09-16-evidence/a7/report.md) — история,
его Android RED устранён последующим filename fix.

| Проверка | Финальный результат |
| --- | --- |
| TypeScript / unit | PASS, 276 tests |
| Kotlin ↔ TS contracts | PASS, 21 cases, новый Pocket pin |
| Pocket unit / lint / APK compile | PASS; точные totals в отчёте |
| Android full connected suite | PASS: 240 passed / 6 opt-in skipped / 0 failures (246 XML cases) |
| Canonical folder → production Reader → SaveNote → export | PASS, точные MD/manifest bytes, edits/signals deep-equal, note `Pocket roundtrip note 🦊` |
| Forge package / packaged executable | PASS, пересобран после filename fix |
| Полный desktop suite | PASS, 46 passed / 1 perf skip |
| Финальный exported folder в packaged Desk | PASS, canonical и legacy варианты; 3 active / 2 conflicting / 1 unavailable; Apply→Undo exact pair |
| Performance | PASS: open 1013 ms ≤2000; input→DOM p95 27.8 ms ≤50 |
| Chromium CDP composition и multiline/emoji/CRLF | PASS в полном desktop suite |
| Реальный macOS / Linux system IME / native clipboard | not-run |
| Native picker в packaged smoke / подпись / notarization / GitHub dispatch | not-run |

Машина: CachyOS rolling, Linux 7.2.4-3-cachyos, glibc2.44, Ryzen7 5800X,
65,741,008 kB RAM; Node26.2.0/npm11.13.0/Electron44.4.0. DISPLAY/XAUTHORITY/
GTK_MODULES взяты из текущей desktop user-manager среды; fuses не ослаблялись.
Android emulator-5554: Android15/API35, sdk_gphone64_x86_64.

Performance: 100 глав, 1,048,645-byte глава, 500 records, 24 inputs; один worker,
без параллельного Electron suite, Android emulator продолжал работу.
[Все финальные samples](reviews/2026-09-16-evidence/a7-compat/performance-results.json).
DOM timing не равен paint/fsync. Отдельная метрика confirmed save включает
host dispatch, polling sidecar reconstruction и UI ack. Close/reopen подтверждает
точный полный текст без потерянного/двойного ввода и неизменные исходные bytes.

Android harness импортирует только synthetic fixture в поддерживаемый offline
cache/Room availability, затем вызывает production ReaderRepository и
saveChapterNote. Это не проверка облачного транспорта и не визуальный UI-test
Pocket. Экспорт действительно возвращён в production packaged Desk. Harness
удаляет только собственную synthetic регистрацию/cache после экспорта: первая
full-suite попытка обнаружила загрязнение тестовой среды этой регистрацией;
сохраняются её failure log и финальный полный прогон после исправления cleanup.

Предупреждения package: native-config compatibility, inlineDynamicImports
и размер bundle; Pocket build без YANDEX_CLIENT_ID, известный JVM CDS warning.
Forge ZIP maker ранее не прошёл из-за `spawn zip ENOENT`; новый portable ZIP
создан тем же Python builder с UNIX permissions/symlinks и CRC check. Проверялся
исходный packaged executable; отдельный запуск распакованного ZIP не выполнен.
