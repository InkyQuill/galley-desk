# Galley Desk: доведение после аудита — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Этот документ сам не запускает реализацию или субагентов.

**Goal:** Устранить подтверждённые ошибки сохранности/идентичности и завершить оставшиеся проверки первой версии.

**Architecture:** Сохранить существующие pocket-format → review-engine → book-storage → Electron boundaries. Исправления локальны к текущим API; добавляется только необходимое подтверждение завершения renderer-очереди перед закрытием. Нового хранилища, постоянной истории и инфраструктурного скаффолдинга не требуется.

**Tech Stack:** Существующие Electron/React/TypeScript/CodeMirror, Vitest/Playwright, Kotlin/Gradle и Bun/Tauri в связанных репозиториях; версии брать из проверяемых lockfiles.

**Spec:** [Спецификация v1](../specs/2026-09-15-galley-desk-design.md), [аудит и матрица 18 задач](../../reviews/2026-09-16-implementation-audit.md). Закрытые планы: [архив](../../archive/plans/2026-09-15/2026-09-15-galley-desk-implementation.md).

## Global Constraints

- Основные платформы: Linux и macOS.
- Обычный ввод создаёт правки в sidecar; исходный Markdown не меняется.
- Схемы v1 не расширяются дополнительными полями Galley Desk.
- Пересечение сохранённых диапазонов не является причиной отвергать весь sidecar при чтении или записи.
- Сигналы могут пересекаться; независимые сигналы не удаляются при применении/отклонении правки.
- Закрытие книги/проекта очищает оба стека всех глав; Undo живёт только в сессии.
- Исходный Markdown сохраняет точные UTF-8 bytes и переводы строк.
- Перед продолжением записи незавершённая операция разрешается; ошибка сохранения не называется успехом.
- Renderer работает с включённой изоляцией контекста, без Node integration.
- Разрешены изменения Galley Editor, Galley Pad и Pocket Editor. Чужие изменения в основных рабочих копиях не отменять; выбрать соответствующие feature-worktrees из отчёта.
- План/спецификацию редизайна Claude не менять и не включать в этот объём. Внешний вид не является условием исправления сохранности данных.
- Нет SQL, переносимого журнала, постоянного Undo, ручной перепривязки, поиска папок книг или автоматического merge текста.

## Порядок и границы файлов

A1 → A2 → A3 → A4 → A5 → A6 → A7. Каждый пункт заканчивается отдельным проверенным изменением. Не переписывать большие файлы целиком ради структуры. Пути без другого корня относятся к `/home/inky/Development/galley-desk`.

| Область | Файлы | Ответственность |
| --- | --- | --- |
| Применение | `packages/review-engine/src/apply.ts`, `apply.test.ts` | Сохранение записей и детерминированные anchors |
| Сессии/запись | `packages/book-storage/src/session.ts`, `book.ts`, `journal.ts` и их тесты | Не терять pending и незавершённую операцию |
| Lifecycle/IPC | `apps/desktop/src/main/{main,book-service,ipc}.ts`, `src/preload/index.ts`, `src/shared/api.ts` | Подтверждение закрытия, идентичность команд |
| Renderer | `apps/desktop/src/renderer/editor/ReviewEditor.tsx`, `book/BookWindow.tsx` | Дренирование FIFO, понятные ограничения записи |
| Интеграция | связанные worktrees, `docs/compatibility.md`, `tests/contracts/baseline.json` | Проверяемые редакции и реальные consumer gates |
| Приёмка | `tests/desktop`, `docs/verification.md`, runbooks | Linux/macOS/Android и долговременный протокол |

---

### Task 1: A1 — Применение сохраняет сигналы и доступность соседних записей

**Files:** Modify `packages/review-engine/src/apply.ts`; Test `packages/review-engine/src/apply.test.ts`, `packages/book-storage/src/session.test.ts`.

**Interfaces:** Существующий `applyEdit(model: ChapterModel, id: string): ChapterModel` остаётся неизменным. Consumes `classifyReview` с разрешёнными byte ranges, produces новую пару source/review без утраты чужих IDs.

- [ ] **Step 1: Добавить RED-регрессии.** В `apply.test.ts` использовать существующие `reviewWith`, `signalOn`, `E1/E2`; заменить тест, требующий удаления внутреннего сигнала.

```ts
test('apply keeps an independent signal whose selection disappeared', () => {
  const source = new TextEncoder().encode('кот');
  const edit = { id: E1, before: 'кот', after: 'кит', anchor: makeAnchor(source, { from: 0, to: 6 }) };
  const signal = signalOn(source, E2, 0, 6, 'не терять');
  const next = applyEdit(openChapter(source, reviewWith(source, [edit], [signal])), E1);
  expect(next.review.signals).toEqual([signal]);
});
test('apply refreshes an earlier active anchor even with zero shift', () => {
  const source = new TextEncoder().encode('aa bb');
  const edits = [
    { id: E1, before: 'aa', after: 'X', anchor: makeAnchor(source, { from: 0, to: 2 }) },
    { id: E2, before: 'bb', after: 'aa', anchor: makeAnchor(source, { from: 3, to: 5 }) },
  ];
  const next = applyEdit(openChapter(source, reviewWith(source, edits)), E2);
  expect(next.text).toBe('X aa');
  expect(next.review.edits[0]!.anchor).toEqual(makeAnchor(next.source, { from: 0, to: 2 }));
});
```

- [ ] **Step 2:** `npx vitest run packages/review-engine/src/apply.test.ts` — убедиться в двух содержательных FAIL.
- [ ] **Step 3:** Обновлять anchor активной правки до замены с delta=0, после — с delta=shift. Так же обновлять непересекающиеся активные сигналы. Внутренний/частично утраченный диапазон сохранять как исходную запись; недоступные записи не трогать. Опорная ветка для edits:

```ts
const delta = oldRange.from >= range.to ? shift : 0;
const moved = { from: oldRange.from + delta, to: oldRange.to + delta };
return [{ ...candidate, anchor: makeAnchor(source, moved) }];
```

Не добавлять persisted unavailable-флаг или поддельный hash: статус вычисляет общий resolver. Обновить комментарий алгоритма, сейчас обещающий удаление.

- [ ] **Step 4:** Добавить сигнал перед заменой с повторяющимся текстом и session apply→undo→redo с точным равенством исходной пары/сигналов. Запустить `npx vitest run packages/review-engine/src/apply.test.ts packages/book-storage/src/session.test.ts`, затем `npm run test:contracts`.
- [ ] **Step 5:** Коммит выбранных файлов: `fix(review-engine): preserve records across apply`.

### Task 2: A2 — Закрытие не теряет pending-текст и не уничтожает failed session

**Files:** Modify `packages/book-storage/src/session.ts`, `apps/desktop/src/main/main.ts`, `book-service.ts`, `ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/renderer/editor/ReviewEditor.tsx`, `book/BookWindow.tsx`; Test `book-service.test.ts`, `session.test.ts`; Create `tests/desktop/close-pending.spec.ts`.

**Interfaces:** Сохранить `BookService.closeBook(bookId): Promise<void>` и `closeAll(): Promise<void>`: reject означает, что книга/окно ещё доступны. Добавить renderer-контракт `flushPending(): Promise<void>`: resolve только когда FIFO пуста и все команды подтверждены main; reject при blocked/error. В lifecycle использовать request/ack с одноразовым ID закрытия, не выполнять произвольные renderer-команды из main.

- [ ] **Step 1:** Перенести тест `audit: failed close retains session and recoverable draft` из [service-repro](../../reviews/2026-09-16-evidence/service-repro.test.ts) в `book-service.test.ts`, используя его существующий `makeService`. В конце добавить проверку повторного доступа к `openChapter` после отказа закрытия. Это воспроизводит отказ appData после открытия, без chmod-зависимости от root.
- [ ] **Step 2:** `npx vitest run apps/desktop/src/main/book-service.test.ts` — RED на утраченной книге.
- [ ] **Step 3:** Переставить удаление из реестра после успешного закрытия. Не очищать историю/главы до успешного общего этапа подготовки; partial failure книги не должна уничтожать остальные сессии. Опорный порядок:

```ts
// При любой ошибке оставить book в registry и watcher активным.
await Promise.all([...book.chapters.values()].map(async (entry) => {
  if (entry.kind === 'live') await entry.session.flushPending();
}));
for (const entry of book.chapters.values()) {
  if (entry.kind === 'live') await entry.session.close();
}
stopWatching(bookId);
books.delete(bookId);
```

Здесь `ChapterSession.flushPending(): Promise<void>` — новый метод: drain queue, reject на failed save; историю не очищает. `close()` после него очищает оба стека. При неудачной записи сохранить pending-пару через существующий `writeDraft`; если appData тоже недоступен, оставить её в памяти и отказать закрытию. Не выдавать сообщение о сохранённом черновике без успешного завершения записи.

- [ ] **Step 4:** Перед закрытием книги/BrowserWindow запросить `flushPending()` renderer. При reject сохранить окно и локальный текст; существующие действия разрешения ошибки остаются доступны. На macOS обработать закрытие последнего окна отдельно от завершения процесса. Повторный quit должен быть защищён от рекурсии/двойного ack.
- [ ] **Step 5:** В новом Electron-тесте на временной книге отправить 50 вводов и сразу Close, открыть снова, сравнить весь текст; второй сценарий — отказ записи appData и Close оставляет окно/черновик. Третий — после успешного закрытия и повторного открытия оба Undo пусты. Дождаться ack, не добавлять фиксированный sleep как гарантию сохранения.
- [ ] **Step 6:** `npm run typecheck`; focused unit; `npm run package`; `npx playwright test tests/desktop/close-pending.spec.ts --workers=1`. Коммит: `fix(storage): preserve pending work when close fails`.

### Task 3: A3 — Не продолжать запись поверх неразрешённого recovery

**Files:** Modify `packages/book-storage/src/book.ts`, `journal.ts`, `apps/desktop/src/main/book-service.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/renderer/book/BookWindow.tsx`; Test `book.test.ts`, `book-service.test.ts`, `tests/desktop/external-change.spec.ts`.

**Interfaces:** `recoverBook(book, appData)` сохраняет существующие результаты `clean | recovered | external-change`. `writePair` отклоняет запись при незавершённом журнале. Текущее `resolveExternal(bookId, chapterId, choice: 'open-external' | 'export-local')` расширить на recovery-conflict, без отдельного экрана merge.

- [ ] **Step 1:** Перенести тест `audit: unresolved third revision must block new writes and preserve journal` из service-repro в штатный test. После отказа дополнительно проверить сохранение исходного `JournalRecord.before/after` и byte identity внешних файлов.
- [ ] **Step 2:** `npx vitest run apps/desktop/src/main/book-service.test.ts` — RED: сейчас команда accepted, journals=0.
- [ ] **Step 3:** В storage проверять pending journal **внутри очереди, до нового writeJournal**; не перезаписывать его. В main при external-change возвращать ограниченный snapshot/состояние recovery, блокирующее команды, вместо одного console.error. Опорная проверка:

```ts
const pending = (await readJournalsForRoot(appData, book.root))
  .some((record) => record.chapter_id === chapterId && !record.complete);
if (pending) throw new Error('Unresolved chapter recovery');
```

Связать ошибку с существующим стабильным IPC-кодом и видимым уведомлением. Проверку обычного повторного сохранения выполнять только после recoverBook/явного разрешения.

- [ ] **Step 4:** `export-local` экспортирует согласованную локальную пару из journal.after в новую выбранную папку без перезаписи чужих файлов. `open-external` сначала сохраняет резервную пару/журнал в appData под отдельным именем; только после успешной записи и явного выбора пользователя завершает pending operation и открывает внешнюю пару. При отказе backup/export journal остаётся и команды заблокированы. Не переносить этот журнал в папку книги автоматически.
- [ ] **Step 5:** Проверить interrupted prepared/source-written/review-written; third revision; отказ экспорта; reopen после явного разрешения. Команды: `npx vitest run packages/book-storage/src/book.test.ts apps/desktop/src/main/book-service.test.ts`; после package — `npx playwright test tests/desktop/external-change.spec.ts --workers=1`.
- [ ] **Step 6:** Коммит: `fix(storage): block writes until recovery is resolved`.

### Task 4: A4 — Редактирование сигнала сохраняет ID

**Files:** Modify `apps/desktop/src/main/book-service.ts`; Test `book-service.test.ts`, `tests/desktop/review-actions.spec.ts`.

**Interfaces:** Существующий `Command` type `signal` с optional `id` остаётся неизменным; id означает обновление существующего сигнала, отсутствие id — создание.

- [ ] **Step 1:** Перенести `audit: changing a signal preserves id` из service-repro. В существующем desktop-сценарии изменения сигнала читать sidecar до/после и сравнивать IDs, не только число записей.
- [ ] **Step 2:** `npx vitest run apps/desktop/src/main/book-service.test.ts` — RED на UUID.
- [ ] **Step 3:** Сохранить идентичность:

```ts
const id = command.id ?? randomUUID();
const next = addSignal(withoutReplaced, command.from, command.to,
  command.signalType, command.comment, id);
```

Перед удалением проверять, что `command.id` действительно принадлежит сигналу текущей главы; ID правки/несуществующий ID не должны превращать его в сигнал. Для недоступного anchor не угадывать новый диапазон.

- [ ] **Step 4:** Проверить UUID, новый type/comment, Undo/Redo, reopen, отказ неизвестного ID и сохранение других записей. Unit + `npx playwright test tests/desktop/review-actions.spec.ts --workers=1` после package.
- [ ] **Step 5:** Коммит: `fix(desktop): preserve signal identity on update`.

### Task 5: A5 — Отказ идентичности и read-only видны до начала ввода

**Files:** Modify `packages/book-storage/src/book.ts`, `apps/desktop/src/main/book-service.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/renderer/book/BookWindow.tsx`, `editor/ReviewEditor.tsx`; Test `book.test.ts`, `book-service.test.ts`, `tests/desktop/open-book.spec.ts`.

**Interfaces:** `openBook(root): Promise<BookHandle>` не создаёт manifest при существующих sidecar без manifest. Добавить к `Snapshot` сериализуемое `readOnlyReason: string | null`; main заполняет, renderer выключает ввод и показывает причину. Это UI DTO, не изменение Pocket wire format.

- [ ] **Step 1:** Перенести `audit: missing manifest with existing sidecar must not create new identity`. Добавить сравнение содержимого sidecar и отсутствие `.pocket-editor.json` после отказа.
- [ ] **Step 2:** Focused tests дают RED. Для malformed sidecar snapshot должен иметь reason, а CodeMirror в Electron-тесте должен быть read-only с первого кадра.
- [ ] **Step 3:** В `openBook`, до генерации IDs:

```ts
if (names.some((name) => name.endsWith('.review.json'))) {
  throw new ManifestError(manifestAbs, new Error('Existing reviews require the original manifest'));
}
```

Не восстанавливать manifest догадками из sidecar. Сохранить прежнюю ветку нового проекта без рецензий. В snapshot readonly/missing/recovery передать явную причину; не объявлять такую главу редактируемой со статусом «Сохранено».

- [ ] **Step 4:** Проверить чистую папку, валидный sidecar без manifest, невалидный sidecar, неизвестную версию manifest, пропавшую главу. Все исходные файлы неизменны; нет ложного recent-success при отказе. `npm run typecheck`; focused unit; package + open-book.spec.
- [ ] **Step 5:** Коммит: `fix(desktop): surface read-only identity failures`.

### Task 6: A6 — Подтвердить общие библиотеки и исправить проверяемые редакции

**Files (другие корни):**
- Editor `/home/inky/Development/editors/galley-editor/.worktrees/galley-themes-workspace/packages/galley-editor/src/commands/tableEditing.test.ts`, при подтверждении дефекта `tableEditing.ts`.
- Pad `/home/inky/Development/galley-pad/.worktrees/shared-themes/tests/integration/app.spec.ts`, `src/App.tsx`, `package.json`, `bun.lock`.
- Desk `docs/compatibility.md`, `tests/contracts/baseline.json`, `docs/verification.md`.

**Interfaces:** Сохранить опубликованные exports editor/themes и реальные consumer-тесты без mock Galley. Ревизия в baseline должна содержать заявленную миграцию; «проверено» не означает «слито/выпущено».

- [ ] **Step 1:** Editor: воспроизвести сбой table normalization полным `npm test`, затем focused file. Проверить, нужен ли `forceParsing`/ожидание готовности синтаксиса в тестовом helper или сама команда неверно обрабатывает готовый документ. Не менять expected=true просто ради зелёного результата.
- [ ] **Step 2:** Pad: `bun run test:integration --grep 'cancels middle-button'`. Разобрать, какой handler отменяет событие tabstrip. Сохранить отмену middle-click редактора и согласовать точное ожидаемое поведение табов; текущие результаты `defaultPrevented=true / dispatchResult=false` документированы в audit evidence.
- [ ] **Step 3:** Pad: разобрать результат `bun audit --json`, обновить затронутые прямые/транзитивные зависимости минимально совместимым способом, зафиксировать bun.lock. Не выключать audit и не добавлять обход, называющий verify успешным.
- [ ] **Step 4:** Из соответствующих worktrees:

```bash
# Editor
npm test
npm run test --workspace @inkyquill/galley-themes
npm run lint
npm run test:package-consumer
npm run docs:build
npm run build-storybook
# Pad
mise run verify
```

- [ ] **Step 5:** Указать действительные tested commits: Pad начинается с `6f8cfff5175e423d19458571fc71c42b791f30b1`, далее итоговая ревизия исправлений. Проверить npm `0.14.0` как отдельный опубликованный артефакт, не приписывать исходному e5769b6 версию0.14.0 (его package.json ещё0.13.0). Задокументировать статус merge/release Pocket/Editor/Pad. Слияния и публикации выполнять только в отдельном согласованном workflow.
- [ ] **Step 6:** Отдельные коммиты по репозиториям: `test(editor): stabilize table command regression` либо `fix(editor): ...` по установленной причине; `fix(pad): correct middle-button event handling`; `chore(deps): update verification dependencies`; `docs: record verified companion revisions`.

### Task 7: A7 — Реально выполнить desktop/platform gate

**Files:** Existing `tests/desktop/*.spec.ts`, `tests/desktop/performance.spec.ts`, `docs/verification.md`, `docs/runbooks/release.md`; Pocket existing `app/src/androidTest/java/net/inkyquill/pocketeditor/ui/review/UnavailableReviewCardTest.kt`. Create `tests/desktop/packaged-smoke.spec.ts` только для минимального запуска настоящего artifact без ослабления production fuses.

**Interfaces:** Обычные Playwright Electron tests запускают `node_modules/electron` с `apps/desktop` и собранным JS. Это отличается от проверки `apps/desktop/out/...` с asar/fuses. Оба пути нужны; platform gate не может быть заменён unit-тестами.

- [ ] **Step 1:** Локализовать Linux SIGSEGV. Сопоставить чистое минимальное Electron-окно и Desk на том же binary, собрать backtrace/core metadata; проверить системные библиотеки/fontconfig/графический backend. Наблюдавшееся предупреждение fontconfig — лишь улика, не установленная причина. Изменять код/версию Electron только по результату воспроизведения. Не пропускать launch tests ради зелёного gate.
- [ ] **Step 2:** После устранения препятствия и A1–A5:

```bash
npm run typecheck
npm test
npm run test:contracts
npm run package
npm run test:desktop -- --workers=1
GALLEY_PERF=1 npx playwright test tests/desktop/performance.spec.ts --workers=1
```

Использовать DISPLAY/XAUTHORITY текущей графической сессии, не зашивать путь xauth из аудита. Сохранить фактические результаты в verification.md.

- [ ] **Step 3:** Запустить настоящий packaged executable с отдельным временным профилем; открыть синтетическую книгу, ввести правку, дождаться сохранения, закрыть, открыть вновь, применить/undo и сравнить md+review bytes. Не отключать production fuses для подмены packaged smoke обычным electron.launch.
- [ ] **Step 4:** В performance-тесте оставить отдельный input→DOM показатель. Добавить latency до подтверждённой записи и проверку итогового текста после опустошения очереди/переоткрытия. Называть показатели точно: DOM не означает fsync. Измерить книгу 100 глав, главу1MiB/500 записей; критерии исходной спецификации: открытие ≤2s, input→render p95≤50ms. Указать машину и нагрузку, не переносить старые числа как новые.
- [ ] **Step 5:** На macOS выполнить packaged smoke, Cmd+Z/Cmd+Shift+Z, закрытие окна без quit, быстрый ввод→Close, IME composition commit/cancel, вставку multiline/emoji/CRLF. На Linux проверить IME отдельно от синтетического dispatch CompositionEvent. Описать точные версии ОС, сборку и результат.
- [ ] **Step 6:** Pocket: подключить тестовое устройство/эмулятор, выполнить `./gradlew connectedDebugAndroidTest`. Затем передать копию синтетической книги с active/stale/overlapping edits, signals, chapter_note через реально поддерживаемый Pocket путь открытия/синхронизации, вернуть в Desk; сравнить IDs/тексты/порядок. `adb push` само по себе не доказывает, что Pocket открыл эту папку. Не использовать личные книги/credentials в fixtures.
- [ ] **Step 7:** Обновить matrix: PASS/FAIL/not-run, команды и редакции. Если машины/устройства нет, этот шаг остаётся unchecked с конкретной причиной; весь v1 gate не объявлять завершённым. Коммит: `test(desktop): verify release artifacts and roundtrip`.

## Критерий закрытия этого плана

- [ ] R1–R6 воспроизводятся в штатных регрессиях и исправлены без расширения wire schema.
- [ ] Нельзя потерять локальную работу через failed close, а unresolved recovery нельзя молча затереть.
- [ ] Проверенные companion commits соответствуют реальному коду; проверки A6 зелёные либо явно отмечен незакрытый blocker, при котором этот план остаётся открытым.
- [ ] Пройдены реальные Linux/macOS packaged и Android roundtrip gates A7.
- [ ] Документы редизайна не изменены; изменения по результатам аудита имеют собственную историю.

Покрытие: C5/D2/D3 → A2/A3/A5; C6/D4 → A1/A4; L2/L3 → A6; P3/D1/D5 и финальные gates → A7. P1/P2/P4/C1/C2/C3/C4/L1 повторно не скаффолдятся.
