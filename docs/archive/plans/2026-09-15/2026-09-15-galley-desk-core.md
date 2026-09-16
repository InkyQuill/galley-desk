# Galley Desk core Implementation Plan

> **Закрыт и архивирован 2026-09-16 после аудита. Не является активным планом.**
> Реализация проверена по коду и свежим запускам; неполные задачи перенесены в [отдельный план](../../../superpowers/plans/2026-09-16-galley-desk-audit-followup.md).
> [Отчёт, дефекты и статус всех 18 задач](../../../reviews/2026-09-16-implementation-audit.md).
> Исходные checkboxes ниже сохранены как историческая запись: они не отражают результат аудита и не являются очередью выполнения. Факт завершения/остаток указан под заголовками Task. Архивирование не означает «всё выполнено».

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Получить тестируемую модель правок, совместимый формат и восстановимое локальное сохранение.

**Architecture:** Три небольших пакета: pocket-format, review-engine, book-storage. Редактор работает с происхождением фрагментов, storage владеет ревизиями и последовательностью записей; ни один пакет не импортирует Electron или React.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Ajv 2020, Node fs/crypto

**Spec:** [/home/inky/Development/galley-desk/docs/superpowers/specs/2026-09-15-galley-desk-design.md](/home/inky/Development/galley-desk/docs/superpowers/specs/2026-09-15-galley-desk-design.md) — прочитать вместе с CONTEXT.md и ADR перед выполнением.

## Global Constraints

- Основные платформы: Linux и macOS.
- Обычный ввод создаёт правки в sidecar; исходный Markdown не меняется.
- Схемы v1 не расширяются дополнительными полями Galley Desk.
- Пересечение сохранённых диапазонов не является причиной отвергать весь sidecar при чтении или записи.
- Сигналы могут пересекаться.
- Закрытие книги/проекта очищает оба стека всех глав.
- Renderer работает с включённой изоляцией контекста, без Node integration.
- В рамках реализации разрешены необходимые изменения Galley Editor, Galley Pad и Pocket Editor; существующее поведение этих проектов не является неизменяемым ограничением.
- Правка / сигнал — термины интерфейса; не «предложение». Исходный Markdown сохраняет точные UTF-8 bytes и переводы строк.
- На время выполнения проверить AGENTS.md соответствующего репозитория и рабочее дерево. Существующие изменения других агентов/пользователя не отменять. Изолированный worktree создавать только при выполнении плана.
- Тестовые фрагменты ниже — начальные исполняемые регрессии, алгоритмы — конкретные опорные участки; остальные перечисленные примеры добавлять отдельными короткими циклами RED/GREEN. Не считать один пример полной проверкой задачи.

---

## Корень и карта файлов

Корень: `/home/inky/Development/galley-desk`. Здесь пока только документация, Git ещё не инициализирован. C1 создаёт минимальную библиотечную сборку без Electron; D1 добавляет исполняемое приложение. У каждого пакета `src/index.ts` — только публичные exports, package.json и tsconfig.json. Сборка `tsc -b`, root `npm test -- <path>` вызывает Vitest, `npm run typecheck` вызывает `tsc -b --pretty false`.

- pocket-format: `documents.ts`, `anchors.ts`, `availability.ts`, `discovery.ts`.
- review-engine: `model.ts`, `pieces.ts`, `edit.ts`, `signals.ts`, `apply.ts`, `history.ts`.
- book-storage: `files.ts`, `book.ts`, `save-queue.ts`, `journal.ts`, `session.ts`.
- fixtures и межъязыковые scripts находятся в `tests/contracts/` и `scripts/`.

## Общие типы — создать в C1, не дублировать в других пакетах

```ts
// packages/pocket-format/src/documents.ts — wire names сохранены
export type Anchor = {
  source_sha256: string; selection_sha256: string;
  start_byte: number; end_byte: number; start_line: number; end_line: number;
  prefix: string; suffix: string;
};
export type Edit = { id: string; before: string; after: string; anchor: Anchor };
export type SignalType = 'note'|'change_required'|'warning'|'review';
export type Signal = { id: string; type: SignalType; selected_text: string;
  anchor: Anchor; comment: string };
export type Review = { schema_version: 1; chapter_id: string; source_path: string;
  chapter_note: string; edits: Edit[]; signals: Signal[] };
export type Chapter = { id: string; path: string; title: string };
export type Manifest = { schema_version: 1; book_id: string; title: string;
  chapters: Chapter[]; ignored_files: string[] };
export type Range = { from: number; to: number }; // UTF-8 bytes только в pocket-format
export type Resolution = { kind: 'resolved'; range: Range } |
  { kind: 'stale' } | { kind: 'ambiguous'; candidates: Range[] };
export type Availability = { edits: Map<string, Range>; signals: Map<string, Range>;
  unavailable: Map<string, Resolution>; conflicting: Set<string> };
```

BigInt не попадает в JSON. Входные offsets должны быть safe integer; файл с числом за пределом безопасного JS integer открывается без перезаписи, даже если формально Kotlin Long его допускает. Это ограничение размерности, не причина нормализовать число с потерей точности.

### Task C1: Сборка чистых пакетов, codec, anchors и обнаружение глав

> **Аудит 2026-09-16:** Реализовано; codec/anchors/discovery и contracts подтверждены.

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/pocket-format/package.json`, `tsconfig.json`, `src/index.ts`, `src/documents.ts`, `src/anchors.ts`, `src/availability.ts`, `src/discovery.ts`
- Create/Test: `packages/pocket-format/src/anchors.test.ts`, `documents.test.ts`, `availability.test.ts`, `discovery.test.ts`
- Copy: Pocket Editor `schemas/manifest-v1.schema.json`, `review-v1.schema.json` → `packages/pocket-format/schemas/`
- Create: `docs/development.md`, `tests/contracts/baseline.json`

**Interfaces:**
- Produces: `decodeReview(json: string, chapterId: string, path: string): Review`, `encodeReview(review: Review): string`, `decodeManifest(json: string): Manifest`, `encodeManifest(manifest: Manifest): string`.
- Produces: `makeAnchor(source: Uint8Array, range: Range): Anchor`, `resolveAnchor(source: Uint8Array, anchor: Anchor, selected: string): Resolution`, `classifyReview(source: Uint8Array, review: Review): Availability`.
- Produces: `discover(files: {path: string; bytes: Uint8Array}[], manifest?: Manifest): {path: string; title: string}[]`. Порядок сравнивается с текущими BookDiscovery/ChapterTitleExtractor и кодом initial import Pocket Editor, а не догадкой по README.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { expect, test } from 'vitest';
import { makeAnchor, resolveAnchor } from './anchors';
test('uses byte offsets without normalizing CRLF', () => {
  const source = new TextEncoder().encode('я🙂\r\nкот');
  const anchor = makeAnchor(source, { from: 8, to: 14 });
  expect(anchor.start_line).toBe(2);
  expect(resolveAnchor(source, anchor, 'кот')).toEqual({
    kind: 'resolved', range: { from: 8, to: 14 }
  });
});
```
При создании нового repo выполнить `git init -b main` только если .git ещё нет. Первую конфигурацию не тестировать зеркальными assertions; RED — этот доменный тест.

- [ ] **Step 2: Проверить RED**

Run: `npm test -- packages/pocket-format/src`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Создать npm workspaces `packages/*`, `apps/*`; root scripts test=vitest run, typecheck=tsc -b; добавить tsx для scripts, которые создают TypeScript fixtures. Vitest по умолчанию запускает `packages/**/*.test.ts` и `apps/**/*.test.ts`; при `GALLEY_CONTRACTS=1` также `tests/contracts/**/*.test.ts`. Playwright specs не запускать через Vitest. Выбрать актуальные совместимые dev dependencies через npm --save-exact, зафиксировать lockfile и Node engine по требованиям выбранной версии Vite при D1. Codec использует Ajv2020 для скопированных схем, затем relational checks UUID uniqueness, identity, differing before/after. Defaults заполнять явно как Kotlin; не использовать coercion/removeAdditional. Пересечения в codec не отвергать.

Anchor создаётся из точных bytes, decode UTF-8 fatal, границы не разрывают code point; prefix/suffix — максимум 128 Unicode code points:
```ts
const selected = new TextDecoder('utf-8', { fatal: true }).decode(source.slice(range.from, range.to));
const prefix = Array.from(new TextDecoder('utf-8', { fatal: true }).decode(source.slice(0, range.from))).slice(-128).join('');
```
Хешировать через SHA-256 (`node:crypto`); renderer не импортирует этот пакет в D1. Resolver повторяет P1/Kotlin дословно по семантике: hash selected, exact range on equal source hash, exact occurrence search otherwise, then prefix/suffix. `classifyReview` исключает всех участников пересечения. Canonical JSON — фиксированный порядок полей, records сортируются по id, две позиции indentation и один LF. Проверить escaping против Kotlin, не считать JSON.stringify заведомо побайтно одинаковым.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- packages/pocket-format/src`
Expected: PASS.

- [ ] Неверный hash, emoji внутри context, пересечения A-B-C, stale+active, неизвестная версия, duplicate IDs, unsafe numbers, пустой source.
- [ ] Discovery: hidden md, nested paths, ignored_files, 2/10, русские заголовки и существующий manifest. Не менять порядок уже известных глав.
- [ ] `npm run typecheck`; docs/development описывает scripts и границы пакетов. baseline.json фиксирует реальные commit SHA исходных репозиториев через `git rev-parse HEAD`, не плавающий main.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(format): implement pocket documents and anchors"
```

### Task C2: Двусторонние Kotlin ↔ TypeScript контракты

> **Аудит 2026-09-16:** Реализовано; 21 двусторонний тест подтверждён.

**Files:**
- Create: `scripts/check-contracts.mjs`, `tests/contracts/generate.ts`, `tests/contracts/exchange.test.ts`, `tests/contracts/cases.json`
- Modify: `tests/contracts/baseline.json`, `package.json`
- Modify in Pocket Editor: `app/src/test/java/net/inkyquill/pocketeditor/contracts/DesktopExchangeTest.kt` (P4)
- Create: `.github/workflows/contracts.yml`, `docs/compatibility.md`

**Interfaces:**
- Consumes: C1 codecs and P4 exchange test. Produces: `npm run test:contracts` using `POCKET_EDITOR_DIR` override or isolated pinned checkout in `.cache/contracts/pocket-editor`.
- Exchange review case: P4 `{name,source,review}`. Additional output `anchors: {source,from,to,anchor}[]`, `discovery: {files:{path,text}[],paths:string[]}[]`. from/to — bytes; review output retains actual Kotlin canonical representation and state lists.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodeReview, encodeReview } from '../../packages/pocket-format/src/documents';
const output = JSON.parse(readFileSync('.cache/contracts/exchange/output.json', 'utf8'));
for (const c of output.cases) {
  test(`Kotlin review round trip: ${c.name}`, () => {
    const review = decodeReview(JSON.stringify(c.review), c.review.chapter_id, c.review.source_path);
    expect(JSON.parse(encodeReview(review))).toEqual(c.review);
  });
}
```
Дополнить этим же входом сравнение classifyReview id lists и Kotlin anchors с makeAnchor, discovery paths с discover.

- [ ] **Step 2: Проверить RED**

Run: `npm run test:contracts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Скрипт: создать input.json через TS codec; вызвать Kotlin; проверить его output через TS тесты. Каждый failure даёт non-zero exit. Внешняя папка из env должна содержать ожидаемый test class; иначе понятная ошибка, не skip.
```js
const result = spawnSync('./gradlew', [
  'testDebugUnitTest', '--tests', '*DesktopExchangeTest', '--rerun-tasks'
], { cwd: pocketDir, env: { ...process.env, GALLEY_EXCHANGE_DIR: exchangeDir }, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
```
`pocketDir` разрешается из env или pinned baseline; `exchangeDir` — абсолютная .cache/contracts/exchange. Использовать импорт spawnSync из node:child_process. Затем spawnSync npm test для exchange.test.ts с env GALLEY_CONTRACTS=1. input generator реализовать в `tests/contracts/generate.ts`, вызываемом через tsx; его output shape совпадает с P4. CI checkout Desk + pinned Pocket revision, JDK 17 и Android SDK по текущему android.yml Pocket, npm ci. Никаких секретов Яндекс для unit fixtures. fixtures — только синтетические рукописи.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm run test:contracts`
Expected: PASS.

- [ ] Передать TS → Kotlin active/stale/conflicting, записать note и comment в Kotlin, перечитать TS; в обратную сторону сравнить генерацию anchors и порядок глав.
- [ ] Зафиксировать минимальный Pocket release после его реального выпуска, до этого явно показывать tested commit в compatibility.md.
- [ ] Повредить один selection hash в fixture: оба resolver возвращают stale, codec не теряет запись; удалить input — тест действительно падает.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "test(contracts): verify kotlin typescript exchange"
```

### Task C3: Модель производного текста и редактирование с происхождением фрагментов

> **Аудит 2026-09-16:** Реализовано в unit-объёме; platform/IME проверка перенесена в A7.

**Files:**
- Create: `packages/review-engine/package.json`, `tsconfig.json`, `src/index.ts`, `src/model.ts`, `src/pieces.ts`, `src/edit.ts`
- Create/Test: `packages/review-engine/src/edit.test.ts`, `pieces.test.ts`

**Interfaces:**
- Consumes: C1 Review/Edit/Availability, makeAnchor, resolveAnchor.
- Produces: `type TextChange = {from: number; to: number; insert: string}` (UTF-16 of derived Markdown); `type Piece = {text: string; source: Range; editId?: string}`; `type ChapterModel = {source: Uint8Array; review: Review; pieces: Piece[]; text: string; selection: {anchor:number;head:number}}`.
- Produces: `openChapter(source: Uint8Array, review: Review): ChapterModel`, `changeText(model: ChapterModel, changes: TextChange[], selection: {anchor:number;head:number}, newId: () => string): ChapterModel`, `sourceRange(model: ChapterModel, from: number, to: number): Range`. Range bytes, selection UTF-16; inserted piece refers to originating replacement range, not invented byte positions.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { expect, test } from 'vitest';
import { openChapter, changeText } from './index';
import type { Review } from '@galley-desk/pocket-format';
test('editing an existing correction keeps identity', () => {
  const review: Review = {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[]};
  const source = new TextEncoder().encode('кот');
  const first = changeText(openChapter(source, review), [{from:1,to:2,insert:'и'}],
    {anchor:2,head:2}, () => '22222222-2222-4222-8222-222222222222');
  const second = changeText(first, [{from:1,to:2,insert:'а'}], {anchor:2,head:2},
    () => { throw new Error('must reuse id'); });
  expect(second.text).toBe('кат');
  expect(second.review.edits[0].id).toBe(first.review.edits[0].id);
  expect(second.source).toEqual(source);
});
```

- [ ] **Step 2: Проверить RED**

Run: `npm test -- packages/review-engine/src/edit.test.ts packages/review-engine/src/pieces.test.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Использовать массив source-backed/replacement pieces, не diff всего документа на каждое нажатие. openChapter сортирует active ranges, вставляет неизменённые source slices между ними, replacement text из after; inactive records остаются в review, не в pieces. CRLF в редакторском тексте нормализован в LF, но source slices и таблица координат сохраняют исходную длину EOL.

changeText: проверить не пересекающиеся changes в старых координатах, обработать справа налево; определить минимальный покрывающий исходный диапазон и все затронутые replacement pieces; расширить чистую вставку на соседний code point (приоритет слева, на BOF справа), включить пересекающиеся правки. Склеить after из surviving pieces и insert; переиспользовать UUID левой затронутой правки, иначе newId. Удалить поглощённые правки; сигналы пока не менять. Если before==after, не сохранять правку.
```ts
const before = new TextDecoder('utf-8', { fatal: true }).decode(model.source.slice(range.from, range.to));
const replacement = before === after ? [] : [{ id, before, after,
  anchor: makeAnchor(model.source, range) }];
```
`range`, `after`, `id` вычисляются предыдущими шагами алгоритма. Повторно строить производные pieces только после обновления review. Пустой source не принимает changeText: выбросить Error('EMPTY_SOURCE'). Новые EOL внутри after использовать стиль первого EOL исходника, при отсутствии LF; неизменённые куски никогда не перекодировать с другим EOL. Multi-change transaction — одна логическая операция истории.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- packages/review-engine/src/edit.test.ts packages/review-engine/src/pieces.test.ts`
Expected: PASS.

- [ ] Отдельные RED/GREEN: BOF/EOF insertion, deleting all text then typing, insertion beside adjacent edit, crossing two edits, restoring original, emoji boundary, multi-cursor edits, paste and multi-paragraph changes.
- [ ] Проверить sourceRange внутри after возвращает исходный range правки; mixed selection покрывает весь исходный диапазон.
- [ ] Тест CRLF вне изменённого диапазона остаётся побайтно неизменным после C5 apply. UTF-16 границы внутри surrogate pair отвергать, не резать символ.
- [ ] Тест stale record с теми же offsets остаётся в review и не участвует в replacement merge.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(review): track derived edits against source pieces"
```

### Task C4: Сигналы и история ввода только в сессии

> **Аудит 2026-09-16:** Реализовано в engine; ошибка UUID desktop-handler вынесена в A4.

**Files:**
- Create: `packages/review-engine/src/signals.ts`, `src/history.ts`
- Create/Test: `packages/review-engine/src/signals.test.ts`, `history.test.ts`
- Modify: `packages/review-engine/src/index.ts`

**Interfaces:**
- Consumes: C3 ChapterModel/sourceRange. Produces: `addSignal(model: ChapterModel, from:number, to:number, type:SignalType, comment:string, id:string): ChapterModel`; `setChapterNote(model: ChapterModel, text:string): ChapterModel`; `removeRecord(model:ChapterModel,id:string):ChapterModel`.
- Produces: `class InputHistory { push(before:ChapterModel, after:ChapterModel, group:string):void; undo(current:ChapterModel):ChapterModel; redo(current:ChapterModel):ChapterModel; clear():void }`. Один экземпляр на главу; group задаёт непрерывный ввод, composition — одна group, изменение selection разрывает group.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
test('signal in inserted text uses source selection', () => {
  const source = new TextEncoder().encode('кот');
  const review: Review = {schema_version:1, chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md', chapter_note:'', edits:[], signals:[]};
  const changed = changeText(openChapter(source, review), [{from:3,to:3,insert:' спит'}],
    {anchor:8,head:8}, () => '22222222-2222-4222-8222-222222222222');
  const marked = addSignal(changed, 4, 8, 'note', 'проверить',
    '33333333-3333-4333-8333-333333333333');
  expect(marked.review.signals[0].selected_text).toBe(marked.review.edits[0].before);
  expect(marked.review.signals[0].anchor).toEqual(marked.review.edits[0].anchor);
});
```
Импортировать test/expect, Review, openChapter/changeText/addSignal из указанных задач, не создавать альтернативные типы fixtures.

- [ ] **Step 2: Проверить RED**

Run: `npm test -- packages/review-engine/src/signals.test.ts packages/review-engine/src/history.test.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

addSignal получает sourceRange и создаёт selected_text из исходных bytes, а не из выделенного after:
```ts
const range = sourceRange(model, from, to);
const selected_text = new TextDecoder().decode(model.source.slice(range.from, range.to));
const signal = { id, type, comment, selected_text, anchor: makeAnchor(model.source, range) };
return openChapter(model.source, {...model.review, signals:[...model.review.signals, signal]});
```
Сохранить selection модели при перестроении. removeRecord удаляет по id только соответствующий элемент из edits или signals; не каскадирует. setChapterNote меняет только chapter_note. InputHistory хранит before/after snapshot и selection, объединяет соседние entries одной group, после push очищает redo. `clear` очищает оба массива, без файлового сохранения. При необходимости ограничить память количеством удерживаемых bytes только после измерений, не произвольным скрытым лимитом.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- packages/review-engine/src/signals.test.ts packages/review-engine/src/history.test.ts`
Expected: PASS.

- [ ] Типы всех четырёх сигналов, empty optional comment, изменение типа/комментария существующего UUID через замену соответствующей записи.
- [ ] Отклонение правки сохраняет сигнал; Undo ввода возвращает UUID и курсор; создание новой записи после Undo очищает redo.
- [ ] Закрытие модели вызывает clear; восстановление черновика создаёт пустую историю.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(review): add source anchored signals and session history"
```

### Task C5: Локальная книга, последовательные записи и восстановление пары файлов

> **Аудит 2026-09-16:** Частично: очередь/журнал есть; R2/R3/R6 перенесены в A2/A3/A5.

**Files:**
- Create: `packages/book-storage/package.json`, `tsconfig.json`, `src/index.ts`, `src/files.ts`, `src/book.ts`, `src/save-queue.ts`, `src/journal.ts`
- Create/Test: `packages/book-storage/src/book.test.ts`, `save-queue.test.ts`, `journal.test.ts`

**Interfaces:**
- Consumes: C1 codecs/discovery. Produces: `type Revision = {sourceHash:string; reviewHash:string|null}`; `type Pair = {source:Uint8Array; review:string|null}`; `type BookHandle = {id:string; root:string; manifest:Manifest}`.
- Produces: `openBook(root:string):Promise<BookHandle>`, `readPair(book:BookHandle, chapterId:string):Promise<{pair:Pair; revision:Revision}>`, `writePair(book:BookHandle, chapterId:string, expected:Revision, target:Pair, appData:string):Promise<Revision>`, `recoverBook(book:BookHandle,appData:string):Promise<'clean'|'recovered'|'external-change'>`.
- Produces: `class SaveQueue { enqueue<T>(job:()=>Promise<T>):Promise<T>; drain():Promise<void> }`. Failed job reports error but does not poison scheduling of later explicit retries.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { expect, test } from 'vitest';
import { SaveQueue } from './save-queue';
test('serializes writes without dropping later work', async () => {
  const q = new SaveQueue(); const events: number[] = [];
  const a = q.enqueue(async () => { events.push(1); });
  const b = q.enqueue(async () => { events.push(2); });
  await Promise.all([a,b]); await q.drain();
  expect(events).toEqual([1,2]);
});
```
В journal.test.ts использовать mkdtemp, writeFile, readFile, rm из node:fs/promises, не mock файловую систему для проверки rename.

- [ ] **Step 2: Проверить RED**

Run: `npm test -- packages/book-storage/src`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Очередь без «поглощения» ошибки вызывающего:
```ts
export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();
  enqueue<T>(job:()=>Promise<T>):Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(()=>undefined,()=>undefined);
    return run;
  }
  drain():Promise<void> { return this.tail; }
}
```
openBook realpath выбранной директории; только непосредственные обычные файлы. Существующий manifest читается, отсутствующий создаётся через discover с randomUUID; существующие sidecars без manifest не перезаписывать, показать read-only ошибку идентичности. BookHandle root не принимается обратно от renderer. Главы и sidecar пути проверяются как direct child, symlink за пределы root не открывать для записи.

writePair под одной очередью главы: перечитать pair, проверить expected, записать journal в appData и fsync; journal содержит root, chapterId, before/after bytes в base64 и hashes, version=1. Создать temp source и temp sidecar в папке книги, sync temp, заменить source, затем sidecar; после завершения отметить journal complete и удалить временные файлы. Для отсутствующего review target=null означает удалить только подтверждённый sidecar. Не считать rename двух файлов общей атомарной операцией.

Recovery сравнивает каждый файл с before/after: оба before — завершить prepared operation; mixed before/after — дозаписать недостающий target; оба after — очистить journal; любой третий hash — вернуть external-change, ничего не затирать. Journal хранить локально; нет переносимого журнала. Temp имена не оканчиваются .md/.review.json. На POSIX синхронизировать каталог после rename, ошибку durability не обозначать успешным сохранением.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- packages/book-storage/src`
Expected: PASS.

- [ ] Fault injection через внутренний callback `afterStep?: (step:'prepared'|'source-written'|'review-written')=>void` в journal implementation test seam; на каждом шаге авария и повторный recoverBook сохраняют точную пару без двойного применения.
- [ ] External third version останавливает recovery. Отказ диска не вызывает saved. Missing chapter/sidecar/invalid manifest — не удаляют рецензию.
- [ ] Открыть книгу без манифеста, повторно открыть: UUID и порядок стабильны. Отказ манифеста не оставляет fake recent success.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(storage): persist book revisions with recoverable writes"
```

### Task C6: Применение правки и Undo всей пары

> **Аудит 2026-09-16:** Частично: apply/Undo есть; R1/R4 перенесены в A1.

**Files:**
- Create: `packages/review-engine/src/apply.ts`, `apply.test.ts`
- Create: `packages/book-storage/src/session-history.ts`
- Create: `packages/book-storage/src/session.ts`, `session.test.ts`
- Modify: public `src/index.ts` обоих пакетов

**Interfaces:**
- Consumes: C1 classifyReview/makeAnchor, C3 ChapterModel, C5 Pair/Revision/writePair.
- Produces: `applyEdit(model:ChapterModel,id:string):ChapterModel`; `class ApplyHistory { push(before:Pair,after:Pair):void; undoTarget():Pair|undefined; redoTarget():Pair|undefined; didUndo():void; didRedo():void; clear():void }` in book-storage/session-history.ts. Pair остаётся в book-storage; review-engine не импортирует storage и не образует цикл зависимостей. Targets не двигают cursor до successful write.
- Produces: `class ChapterSession` в storage: `open(book,chapterId,appData):Promise<ChapterSession>` static; fields `model:ChapterModel`, `revision:Revision`, `state:'saved'|'saving'|'error'|'external'`; methods `edit(changes:TextChange[],selection:{anchor:number;head:number}):Promise<void>`, `replaceReview(review:Review):Promise<void>`, `apply(id:string):Promise<void>`, `undoApply():Promise<void>`, `redoApply():Promise<void>`, `checkExternal():Promise<void>`, `undoInput():Promise<void>`, `redoInput():Promise<void>`, `close():Promise<void>`. Internal queue, input/apply histories. Export `readDrafts(appData:string):Promise<{id:string;pair:Pair}[]>`, `exportDraft(appData:string,id:string,destination:string):Promise<void>`; export refuses occupied destination files.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
test('apply shifts an adjacent correction exactly', () => {
  const source = new TextEncoder().encode('abcd');
  const edits = [
    {id:'22222222-2222-4222-8222-222222222222',before:'ab',after:'X',anchor:makeAnchor(source,{from:0,to:2})},
    {id:'33333333-3333-4333-8333-333333333333',before:'cd',after:'Y',anchor:makeAnchor(source,{from:2,to:4})}
  ];
  const review: Review = {schema_version:1,chapter_id:'11111111-1111-4111-8111-111111111111',
    source_path:'01.md',chapter_note:'',signals:[],edits};
  const next = applyEdit(openChapter(source,review), edits[0].id);
  expect(new TextDecoder().decode(next.source)).toBe('Xcd');
  expect(next.review.edits[0].anchor.start_byte).toBe(1);
  expect(next.text).toBe('XY');
});
```

- [ ] **Step 2: Проверить RED**

Run: `npm test -- packages/review-engine/src/apply.test.ts packages/book-storage/src/session.test.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

applyEdit требует active id; replace bytes с from/to resolved range. Сдвиг равен byteLength(after)-(to-from). Активные правки до диапазона не сдвигаются, после — сдвигаются; для всех перенесённых anchors вызвать makeAnchor на новом source. Недоступные записи сохраняются без изменения. Для сигналов вне replacement перенос такой же; пересекающиеся сигналы переносить только по source-backed pieces, иначе сохранить старый anchor. При переносе обновить selected_text. Никакого поиска совпадений для собственной операции.
```ts
const shift = new TextEncoder().encode(edit.after).length - (range.to-range.from);
const moved = oldRange.from >= range.to
  ? {from:oldRange.from+shift,to:oldRange.to+shift} : oldRange;
```
`edit`, `range` — выбранная активная запись; `oldRange` — активная непересекающаяся запись. Session apply ожидает очередь, формирует target Pair, вызывает writePair, затем обновляет history/model/revision. При ошибке не сдвигать историю. undoApply/redoApply повторно используют writePair с проверенной revision и всей целевой парой.

edit/replaceReview очищают apply stack, но сохраняют свою input history; apply очищает input stack. close ждёт очередь, при сохранённой ошибке не закрывает модель автоматически; успешный close очищает обе истории. checkExternal без локальных изменений обновляет модель и histories; с pending/error состоянием сначала сохраняет локальный draft Pair атомарно в appData, затем state=external. UI D3 выбирает открытие внешнего или exportDraft; автоматически не overwrite. Файловая ошибка draft оставляет модель в памяти.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- packages/review-engine/src/apply.test.ts packages/book-storage/src/session.test.ts`
Expected: PASS.

- [ ] Session integration: apply → undo → redo сравнивает byte-for-byte обе пары и все anchors/signals, не только удалённый edit.
- [ ] Обычная мутация после apply инвалидирует apply history; close/open — пустые histories; checkExternal инвалидирует обе.
- [ ] Apply signal entirely removed, stale overlaps current offsets, update note then external write, failing draft write.
- [ ] Зафиксировать методы `undoInput():Promise<void>`, `redoInput():Promise<void>` в ChapterSession, использующие C4 snapshots и обычную очередь сохранения; эти методы не восстанавливают apply stack.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(review): apply corrections with session scoped undo"
```
