# Воспроизведения аудита

Контекст и версии: [отчёт](../2026-09-16-implementation-audit.md). Это диагностические материалы, не реализация исправлений. Все данные синтетические.

Из `/home/inky/Development/galley-desk`:

```bash
./node_modules/.bin/tsx docs/reviews/2026-09-16-evidence/engine-repro.mts
cp docs/reviews/2026-09-16-evidence/service-repro.test.ts apps/desktop/src/main/audit-review.test.ts
npx vitest run apps/desktop/src/main/audit-review.test.ts
rm apps/desktop/src/main/audit-review.test.ts
```

Последнюю команду выполнить и при ненулевом exit code Vitest. Импорты service-repro рассчитаны на временное расположение рядом с book-service.test.ts. Не заменять существующий `audit-review.test.ts`, если он уже появился при исправлениях. Engine-воспроизведение печатает actual/expected, service-воспроизведение содержит четыре assertions на правильное поведение и на проверенной ревизии даёт четыре FAIL.

- `engine-repro.log`: удаление сигнала и потеря доступности предыдущей правки.
- `service-repro.log`: close/error, signal UUID, missing manifest, unresolved recovery.
- `editor-retest.log`: изолированный повтор после одного падения полного набора.
- `pad-retest.log`: воспроизводимое падение middle-button.
- `packaged-smoke.log`: прямой запуск packaged executable, core dump.
