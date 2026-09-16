# Galley Desk desktop Implementation Plan

> **Закрыт и архивирован 2026-09-16 после аудита. Не является активным планом.**
> Реализация проверена по коду и свежим запускам; неполные задачи перенесены в [отдельный план](../../../superpowers/plans/2026-09-16-galley-desk-audit-followup.md).
> [Отчёт, дефекты и статус всех 18 задач](../../../reviews/2026-09-16-implementation-audit.md).
> Исходные checkboxes ниже сохранены как историческая запись: они не отражают результат аудита и не являются очередью выполнения. Факт завершения/остаток указан под заголовками Task. Архивирование не означает «всё выполнено».

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать работающее Electron-приложение с редактором, рецензиями и проверками Linux/macOS.

**Architecture:** Main process владеет ChapterSession и файлами; preload предоставляет узкие команды. Renderer использует Galley для ввода и размещения отметок, применяет authoritative snapshots с номерами ревизий и не пишет файлы напрямую.

**Tech Stack:** Electron, React, TypeScript, Vite, Electron Forge, Playwright, Vitest

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

## Корень, зависимости и файлы

Корень `/home/inky/Development/galley-desk`. Зависимости: C1 для сборки, C3–C6 для рабочей книги, L1–L3 для тем и Galley. D1 может идти после C1; D2 требует C6. Итог — реально запускаемое и упакованное приложение.

Файлы приложения:

- `apps/desktop/src/main/` — main.ts, book-service.ts, ipc.ts, recent-books.ts, resources.ts, settings.ts.
- `apps/desktop/src/preload/index.ts` — contextBridge.
- `apps/desktop/src/shared/api.ts` — сериализуемый IPC контракт, без imports из Electron/Node.
- `apps/desktop/src/renderer/` — App.tsx; book/BookWindow.tsx, RecentBooks.tsx; editor/ReviewEditor.tsx, transaction-adapter.ts, markers.ts; review/SignalFlyout.tsx, RecordPopup.tsx, ReviewList.tsx, ChapterNote.tsx; appearance/Appearance.tsx; search/ChapterSearch.tsx.
- `tests/desktop/` — реальные Electron tests, отдельный temp userData и temp book на каждый тест.

### Сборка

Использовать Electron Forge Vite + TypeScript template как источник совместимой конфигурации, создать во временной директории и перенести только нужные файлы в apps/desktop; не запускать генератор поверх документации. Его Vite plugin официально помечен experimental: зафиксировать версии и проверить package сразу, не строить собственную систему сборки. [Forge template](https://www.electronforge.io/templates/vite-%2B-typescript).

Автоматизация Electron через Playwright также experimental; использовать её для реальных workflow, а packaged smoke дополнять нативной проверкой меню/IME/диалогов. [Playwright Electron](https://playwright.dev/docs/api/class-electron).

## IPC контракт — создать в D1, реализовать в D2

```ts
// apps/desktop/src/shared/api.ts
export type Entry = {id:string; path:string; title:string; missing:boolean};
export type RecordView = {id:string; kind:'edit'|'signal'; status:'active'|'unavailable'|'conflicting';
  reason:string; from:number|null; to:number|null; before:string; after:string;
  comment:string; signalType:'note'|'change_required'|'warning'|'review'|null};
export type Snapshot = {bookId:string; chapterId:string; revision:number; text:string; sourceText:string;
  records:RecordView[]; chapterNote:string; saveState:'saved'|'saving'|'error'|'external';
  canUndoInput:boolean; canRedoInput:boolean; canUndoApply:boolean; canRedoApply:boolean};
export type BookView = {bookId:string; title:string; entries:Entry[]};
export type Recent = {path:string; title:string; missing:boolean};
export type Command =
 | {type:'text'; changes:{from:number;to:number;insert:string}[]; selection:{anchor:number;head:number}}
 | {type:'signal'; id?:string; from:number;to:number; signalType:'note'|'change_required'|'warning'|'review';comment:string}
 | {type:'note';text:string}
 | {type:'remove'|'apply';id:string}
 | {type:'undo-input'|'redo-input'|'undo-apply'|'redo-apply'};
export type AppearanceSettings = {themeId:string; fontFamily:string; fontSize:number; lineWidth:number};
export interface DeskApi {
  appearance():Promise<AppearanceSettings>;
  setAppearance(value:AppearanceSettings):Promise<void>;
  savePosition(bookId:string,chapterId:string,anchor:number,scrollTop:number):Promise<void>;
  chooseBook():Promise<BookView|null>;
  recent():Promise<Recent[]>;
  openRecent(path:string):Promise<BookView>;
  forgetRecent(path:string):Promise<void>;
  openChapter(bookId:string,chapterId:string):Promise<Snapshot>;
  command(bookId:string,chapterId:string,expectedRevision:number,command:Command):Promise<Snapshot>;
  closeBook(bookId:string):Promise<void>;
  onSnapshot(listener:(snapshot:Snapshot)=>void):()=>void;
  resolveExternal(bookId:string,chapterId:string,choice:'open-external'|'export-local'):Promise<Snapshot>;
}
```

RecordView.from/to — позиции производного Markdown UTF-16; null означает, что переход к месту невозможен. Исходный before для сигнала — selected_text; comment никогда не копируется в текст Markdown. revision — монотонный номер сессии, не hash файла. Ошибки IPC имеют стабильный `code` и безопасное сообщение: STALE_REVISION, SAVE_FAILED, EMPTY_SOURCE, UNAVAILABLE_RECORD, BOOK_MISSING. Main логирует код и операцию, не рукопись.

### Task D1: Запускаемое изолированное окно и ранняя упаковка

> **Аудит 2026-09-16:** Package собран; Linux runtime аварийно завершается, macOS не проверен → A7.

**Files:**
- Create: `apps/desktop/package.json`, `forge.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `tsconfig.json`, `index.html`
- Create: `apps/desktop/src/main/main.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/app.css`
- Create/Test: `tests/desktop/shell.spec.ts`, `playwright.config.ts`
- Modify: root `package.json`, `package-lock.json`, `.gitignore`, `README.md`

**Interfaces:**
- Consumes: C1 workspace, DeskApi definition above. Produces: root scripts start (`npm start --workspace @galley-desk/desktop`), package (`npm run package --workspace @galley-desk/desktop`), test:desktop (`playwright test`). Desktop package uses Forge start/package/make. No read/write IPC until D2.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { test, expect, _electron as electron } from '@playwright/test';
test('launches without node access in renderer', async () => {
  const app = await electron.launch({args:['apps/desktop']});
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading',{name:'Galley Desk'})).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  } finally { await app.close(); }
});
```
Перед тестом `npm run package` создаёт Forge .vite/build entry, package main указывает туда. На Linux использовать Xvfb в CI, не отключать sandbox ради теста.

- [ ] **Step 2: Проверить RED**

Run: `npm run package && npm run test:desktop -- tests/desktop/shell.spec.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Создать BrowserWindow с preload из результата Forge template:
```ts
const window = new BrowserWindow({
  width: 1200, height: 850,
  webPreferences: { preload: path.join(__dirname,'preload.js'),
    contextIsolation:true, nodeIntegration:false, sandbox:true }
});
window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
```
Импорты BrowserWindow/app из electron, path из node:path. Сохранить loading dev URL vs packaged HTML из template; renderer React createRoot. В production CSP запрещает script от внешних origins, inline scripts и навигацию из локального Markdown. Не добавлять backend/server.

В root npm scripts desktop packaging проверить с workspace imports C1. При упаковке dependency pure packages должны включаться в main bundle либо поставляться compiled workspace packages; проверить tarball/app содержимое, не полагаться на исходники за пределами приложения.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm run package && npm run test:desktop -- tests/desktop/shell.spec.ts`
Expected: PASS.

- [ ] `npm run typecheck`, `npm run package`; запустить package на текущей платформе.
- [ ] README описывает реальные команды и текущую стадию, не «исполняемого приложения пока нет» после успешного D1.
- [ ] Main requestSingleInstanceLock предотвращает независимый второй writer. Второй запуск фокусирует окно.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(desktop): add isolated electron application shell"
```

### Task D2: Открытие папки, последние книги и безопасный IPC

> **Аудит 2026-09-16:** Частично; identity/read-only и закрытие → A2/A5.

**Files:**
- Create: `apps/desktop/src/main/book-service.ts`, `ipc.ts`, `recent-books.ts`, `resources.ts`, `settings.ts`
- Modify: `apps/desktop/src/main/main.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/book/RecentBooks.tsx`, `BookWindow.tsx`
- Create/Test: `apps/desktop/src/main/recent-books.test.ts`, `ipc.test.ts`, `tests/desktop/open-book.spec.ts`

**Interfaces:**
- Consumes: C5 BookHandle, C6 ChapterSession, DeskApi. Produces: main `createBookService(appData:string)` implementing DeskApi async operations except event subscription; renderer only sees BookView/Snapshot, no filesystem handles. Main owns book-id registry. Recent list stores canonical path, title, last chapter and scroll anchor locally.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { expect, test } from 'vitest';
import { validateCommand } from './ipc';
test('rejects path-bearing arbitrary writes', () => {
  expect(() => validateCommand({type:'writeFile',path:'/tmp/x',text:'bad'})).toThrow();
  expect(() => validateCommand({type:'text',changes:[{from:-1,to:0,insert:'x'}],
    selection:{anchor:0,head:0}})).toThrow();
});
```
`validateCommand(value:unknown): Command` экспортируется из ipc.ts, проверяет discriminant/поля и границы чисел; фактические границы документа проверяет модель.

- [ ] **Step 2: Проверить RED**

Run: `npm test -- apps/desktop/src/main`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

chooseBook вызывает dialog.showOpenDialog({properties:['openDirectory']}); после успеха openBook/recoverBook, затем добавить recent. openRecent принимает только путь из списка; смена пути выполняется новым directory picker и сопоставлением book_id. Main validates senderFrame URL, registered book/chapter IDs и expectedRevision. Unknown version/missing chapter возвращают read-only состояние, не создают пустой исходник поверх файла.
```ts
contextBridge.exposeInMainWorld('desk', {
  chooseBook: () => ipcRenderer.invoke('desk:choose-book'),
  recent: () => ipcRenderer.invoke('desk:recent'),
  openChapter: (bookId:string,chapterId:string) =>
    ipcRenderer.invoke('desk:open-chapter',bookId,chapterId)
});
```
Добавить оставшиеся методы DeskApi тем же явным образом; не expose ipcRenderer или arbitrary channel. onSnapshot оборачивает listener, удаляет конкретный handler на unsubscribe. resources.ts обслуживает только локальные изображения внутри открытого root через opaque bookId; запрет traversal и symlinks наружу. Внешние http(s) ссылки открываются через shell.openExternal после проверки схемы; HTML не исполняется. Remote images в v1 не загружать автоматически.

command возвращает snapshot только принятой revision; при STALE_REVISION renderer не применяет старый optimistic state поверх нового. Файловые действия сериализуются в ChapterSession.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- apps/desktop/src/main`
Expected: PASS.

- [ ] Electron test через `app.evaluate` подменяет только showOpenDialog возвратом temp root; запускает настоящий openBook и renderer. Нет production test API для произвольного открытия пути.
- [ ] Проверить cancel picker, recent reopen, missing folder, forget (файлы остаются), restore chapter/scroll, no recursive discovery.
- [ ] Нет manifest — создаётся совместимый файл; неизвестный schema не перезаписывается; локальная картинка отображается, executable URL отвергается.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(books): open local folders through typed ipc"
```

### Task D3: Galley ввод, ревизии, автосохранение и внешние изменения

> **Аудит 2026-09-16:** Частично; безопасный flush/close и реальный UI gate → A2/A7.

**Files:**
- Create: `apps/desktop/src/renderer/editor/ReviewEditor.tsx`, `transaction-adapter.ts`, `transaction-adapter.test.ts`
- Modify: `apps/desktop/src/main/book-service.ts`, `src/renderer/book/BookWindow.tsx`
- Create/Test: `tests/desktop/edit-and-reopen.spec.ts`, `external-change.spec.ts`

**Interfaces:**
- Consumes: C3 TextChange, C6 session, L3 public extensions, Snapshot/DeskApi.command.
- Produces: `toTextChanges(tr:Transaction):{from:number;to:number;insert:string}[]`; `const fromSnapshot:AnnotationType<boolean>` to tag authoritative replacements. `ReviewEditor({snapshot,onCommand}: {snapshot:Snapshot; onCommand:(c:Command)=>Promise<Snapshot>})` keeps one Galley instance across callbacks.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { EditorState } from '@codemirror/state';
import { expect, test } from 'vitest';
import { toTextChanges } from './transaction-adapter';
test('captures source positions through hidden markdown', () => {
  const state = EditorState.create({doc:'**кот**'});
  expect(toTextChanges(state.update({changes:{from:2,to:5,insert:'кит'}})))
    .toEqual([{from:2,to:5,insert:'кит'}]);
});
```

- [ ] **Step 2: Проверить RED**

Run: `npm test -- apps/desktop/src/renderer/editor/transaction-adapter.test.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

```ts
export const fromSnapshot = Annotation.define<boolean>();
export function toTextChanges(tr:Transaction) {
  const result: {from:number;to:number;insert:string}[] = [];
  if (tr.annotation(fromSnapshot)) return result;
  tr.changes.iterChanges((from,to,_a,_b,text) => result.push({from,to,insert:text.toString()}));
  return result;
}
```
Observer через extensions отправляет транзакции в renderer FIFO. expectedRevision берётся из последнего подтверждения, а не из старого React closure. Пока очередь локального ввода не пуста, не заменять document более старым snapshot. При acknowledgements обновлять records/save state, не сбрасывать cursor или composition. External snapshot отложить до завершения IME и сохранения draft в main; не silent rebase разных исходников. На failed command сохранить локальный текст для восстановления и показать ошибку.

Read-only исходник/сравнение использовать отдельные presentation views, не менять underlying editable state во время ввода. Main fs watcher debounce лишь объединяет уведомления; checkExternal также на фокус и перед записью. Кнопки внешнего изменения используют resolveExternal и native destination picker для export-local. Показать «Сохраняется», «Сохранено», «Ошибка сохранения» без optimistic saved. before-quit/window close ожидает session.close; повторный quit после успешного flush не рекурсивен.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- apps/desktop/src/renderer/editor/transaction-adapter.test.ts`
Expected: PASS.

- [ ] Настоящий editor test: edit `кот` → `кит`, прочитать md неизменным и sidecar с edit, закрыть/открыть — `кит`, пустой Undo.
- [ ] Быстрый ввод 50 транзакций с задержанным main ack не теряет/дублирует символы. IME composition не прерывается.
- [ ] Ошибка сохранения и внешний файл: локальный draft доступен, чужая версия не перезаписана. Нажатие Undo в Text вызывает undo-input, в полях остаётся native undo.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(editor): connect galley transactions to review sessions"
```

### Task D4: Отметки, сигналы, заметка главы и применение

> **Аудит 2026-09-16:** Частично; apply/signals/UUID и UI gate → A1/A4/A7.

**Files:**
- Create: `apps/desktop/src/renderer/editor/markers.ts`
- Create: `apps/desktop/src/renderer/review/SignalFlyout.tsx`, `RecordPopup.tsx`, `ReviewList.tsx`, `ChapterNote.tsx`
- Create: `apps/desktop/src/renderer/editor/ComparisonView.tsx`
- Create/Test: `tests/desktop/review-actions.spec.ts`
- Modify: `apps/desktop/src/renderer/book/BookWindow.tsx`

**Interfaces:**
- Consumes: RecordView positions/status, Command union, snapshots, C6 apply/undo.
- Produces: review controls without forms in right navigation; `ComparisonView({snapshot}:{snapshot:Snapshot})` read-only source + inserted/deleted spans, RecordPopup commands; markers remain available in Text/Comparison, not Source.

- [ ] **Step 1: Зафиксировать регрессию**

В Electron test запустить `_electron.launch({args:['apps/desktop']})`, получить `page = await app.firstWindow()` как D1. Создать temp папку через mkdtemp/writeFile с md `кот` и правкой `кот → кит`, с настоящим makeAnchor; подменить showOpenDialog только в main через app.evaluate как D2; открыть её кнопкой. Затем:
```ts
await page.getByRole('button',{name:'Сравнение',exact:true}).click();
await page.getByRole('button',{name:'Правка',exact:true}).first().click();
await page.getByRole('button',{name:'Применить',exact:true}).click();
await expect(page.getByRole('button',{name:'Отменить применение'})).toBeEnabled();
await page.getByRole('button',{name:'Отменить применение'}).click();
await expect(page.getByRole('button',{name:'Повторить применение'})).toBeEnabled();
```
До/после прочитать обе реальные files и сравнить с fixture Pair, включая сигнал после заменённого диапазона.

- [ ] **Step 2: Проверить RED**

Run: `npm run package && npm run test:desktop -- tests/desktop/review-actions.spec.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

Выделение в editable view открывает flyout без переноса фокуса от copy/navigation. Выбор note/change_required/warning/review открывает попап, Esc отменяет, сохранение отправляет Command signal. Комментарий — подстрока decoration/widget с contenteditable=false; иконка молнии и цвет из текущего Pocket ReviewColors. Правка — карандаш, deletion — zero-width widget с доступным названием. Пересекающиеся сигналы получают независимые controls, не скрываются за первой записью.
```tsx
<button type="button" aria-label="Применить"
  disabled={record.status !== 'active'}
  onClick={() => void onCommand({type:'apply',id:record.id})}>Применить</button>
```
RecordPopup получает RecordView/onCommand; для unavailable/conflicting вместо позиции — сохранённый before/after/comment, причина и удалить. ReviewList selection скроллит только при from!==null, открывает тот же попап; у отсутствующего anchor открывается карточка в панели.

Comparison строить по source segments и active edits с отдельными old/new диапазонами, не textContent DOM. Введённый текст сравнения read-only. ChapterNote textarea отправляет note, хранит draft при ошибке. Undo/Redo context таблица §6, no input hijack в textarea/input. При apply/removal не удалять независимые сигналы.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm run package && npm run test:desktop -- tests/desktop/review-actions.spec.ts`
Expected: PASS.

- [ ] Четыре типа, empty comment, изменение existing signal, signal on added text, reject retains signal, unavailable cards, conflict participants.
- [ ] Проверить selection → flyout → popup клавиатурой; Escape возвращает фокус и не создаёт пустой сигнал.
- [ ] Original view без marks и typing; right panel не содержит дублирующих forms. Apply stack очищается после обычной мутации и закрытия.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(review): add inline signals and apply controls"
```

### Task D5: Поиск, оформление и итоговая проверка packaged-приложений

> **Аудит 2026-09-16:** Функции в коде есть; platform/performance/roundtrip gate → A7.

**Files:**
- Create: `apps/desktop/src/renderer/search/ChapterSearch.tsx`, `search.ts`, `search.test.ts`
- Create: `apps/desktop/src/renderer/appearance/Appearance.tsx`
- Modify: `apps/desktop/src/renderer/book/BookWindow.tsx`, `src/renderer/app.css`, `forge.config.ts`
- Create/Test: `tests/desktop/search-and-appearance.spec.ts`, `tests/desktop/performance.spec.ts`
- Create: `.github/workflows/desktop.yml`, `docs/user-guide.md`, `docs/runbooks/release.md`, `docs/verification.md`
- Modify: `README.md`, `docs/compatibility.md`

**Interfaces:**
- Consumes: L1 getTheme/themeToCssVariables; §3 search rules, snapshot text/sourceText. Produces: `findLiteral(text:string,query:string):{from:number;to:number}[]` using UTF-16 exact literal search; no regex or replace. Theme and font settings stored in appData through typed main settings methods, not arbitrary fs.

- [ ] **Step 1: Зафиксировать регрессию**

```ts
import { expect, test } from 'vitest';
import { findLiteral } from './search';
test('finds literal markdown positions after emoji', () => {
  expect(findLiteral('🙂 кот кот','кот')).toEqual([{from:3,to:6},{from:7,to:10}]);
  expect(findLiteral('кот','')).toEqual([]);
});
```

- [ ] **Step 2: Проверить RED**

Run: `npm test -- apps/desktop/src/renderer/search/search.test.ts`
Expected: тест падает на описанном несовпадении поведения или отсутствующем новом экспорте; ошибка установки окружения не считается RED.

- [ ] **Step 3: Реализовать контракт минимальными шагами**

```ts
export function findLiteral(text:string,query:string) {
  const result: {from:number;to:number}[] = [];
  if (!query) return result;
  for (let from=text.indexOf(query); from>=0; from=text.indexOf(query,from+query.length)) {
    result.push({from,to:from+query.length});
  }
  return result;
}
```
Search Text/Comparison uses snapshot.text, Source uses sourceText; active result in Comparison maps through its explicit segment coordinates. Обновлять результаты при snapshot revision. Названия глав фильтровать без изменения manifest.

Appearance использует themeToCssVariables на контейнере окна; font family/size/line width сохраняются через DeskApi.appearance/setAppearance; main проверяет finite положительные числа (fontSize 10–48, lineWidth 320–1600) и известный themeId. Эти границы UI не изменяют формат книги. Zen скрывает панели и topbar, оставляет постоянную доступную кнопку выхода; Escape сначала закрывает popup, затем при отсутствии popup выходит из Zen. Цвета сигналов поверх темы остаются Pocket-совместимыми.

CI: Linux и macOS jobs npm ci → typecheck → unit → Forge package → Electron tests. Linux Xvfb; macOS native runner. Forge make выдаёт ZIP macOS и Linux archive/дистрибутив из выбранного maker; signed release/notarization описать отдельно и не заявлять выполненными без credentials. Проверять собранный executable, а не только .vite dev entry.

- [ ] **Step 4: Проверить GREEN и закончить сценарий**

Run: `npm test -- apps/desktop/src/renderer/search/search.test.ts`
Expected: PASS.

- [ ] Создать синтетическую книгу 100 глав, одна 1 MiB UTF-8 и 500 записей; зафиксировать hardware, p95 input-to-render <=50ms, opening chapter <=2s после старта, RSS. Если не выполнено — измерить hot path и исправить, не ослаблять fixture молча.
- [ ] `npm run test:contracts`, `npm run typecheck`, `npm test`, `npm run package`, `npm run test:desktop`; зафиксировать результаты в verification.md.
- [ ] На Linux и macOS вручную проверить IME, clipboard, native directory picker, Cmd/Ctrl, масштабирование; отсутствующая платформа остаётся явно непроверенной.
- [ ] End-to-end transfer: Desktop creates active+stale+conflicting reviews → updated Pocket reads/saves note → Desktop rereads, applies one active edit, остальные записи сохранены. Записать tested versions/commits всех четырёх проектов.
- [ ] В руководстве описать недоступные записи, session Undo, ошибки записи, передачу папки после завершения сохранения; реальный пример запуска и сборки в README.

- [ ] **Step 5: Зафиксировать завершённую задачу**

Из корня указанного репозитория добавить только перечисленные файлы этой задачи (и необходимый lockfile), проверить `git diff --cached --check`, затем:

```bash
git commit -m "feat(desktop): finish navigation appearance and platform verification"
```
