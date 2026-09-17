# Workspace UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Сделать действия контекстными, сайдбары удобными по ширине, верх окна компактным, а метаданные необязательными для просмотра; устранить разрывы чтения, поиска и рецензии из UX-pass Claude.

**Architecture:** Существующий book-service сохраняет ответственность за запись/flush/conflict; renderer получает отдельные компоненты оглавления, форм и разделителей. TitleBar используется как единый контейнер действий; настройки layout живут только в профиле.

**Tech Stack:** React 19, Electron Forge/Vite, TypeScript, Tabler icons, Galley themes 0.15.0, Vitest/Playwright; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-17-diagnostics-and-workspace-ux.md`, §2–9 и «Границы и приёмка».

**Review:** [UX-pass Claude](../../reviews/2026-09-17-ux-pass.md); номера историй сохранены как в ревью (№1, 6–12). Это план работ, галочки не означают результаты исходного ревью.

## Global Constraints

- Linux/macOS, Pocket-схемы и sidecar не меняются, обычный ввод остаётся предложением правки.
- Ширины по умолчанию 315/336 px, границы 240–560 px, центр ≥480 px при достаточной ширине окна; клавиатурное сохранение debounce 250 мс.
- Единый chrome 44 px, macOS left inset 82 px; кнопки и поля no-drag.
- Название главы — одна строка с эллипсисом, ниже мелко имя файла.
- Discovery только текущей папки и явное добавление отмеченных файлов.
- Управление/сохранение исходника сохраняет все существующие flush/conflict/recovery проверки.
- Escape никогда не переключает Zen; Ctrl+Alt+Z / Cmd+Alt+Z переключают его по KeyZ, Undo/Redo сохраняются.
- Поиск не забирает фокус из поля; Текст ↔ Сравнение сохраняет viewport-anchor, а не общий scrollTop.
- `_index.md` не исключается автоматически; состав оглавления определяет автор.
- Все подсказки приложения используют общий Tooltip и настройки UI-шрифта.
- Известный macOS selection failure отложен; новые работы не объявляют его исправленным.
- Диагностика — отдельный план. Если он ещё не реализован, не добавлять неработающую кнопку; после его выполнения включить реальный Diagnostics в новое меню.

## Порядок выполнения и покрытие ревью

Номера Tasks 1–6 сохранены, чтобы не потерять ссылки исходного плана.
Рекомендуемый порядок: **7 → 8 → 9 → 10 → 1 → 2 → 3 → 4 → 5 → 6 → 11 → 12 → 13**.
Task 8 исправляет фильтр до переноса его в Task 1; Task 10 предоставляет
Tooltip новым компонентам. Task 4 зависит от 3; Task 2 — от 1. Tasks 11–12
проверяются после layout/chrome, Task 13 завершает весь план. Диагностика
остаётся отдельным планом; существующую интеграцию сохранить.

| История Claude | Задача | Проверяемый результат |
| --- | --- | --- |
| №6 Zen/Esc | 7; регрессия 4–6 | Двойной Escape не выходит из Zen; отдельная комбинация работает |
| №8 Поиск | 8 | Первая находка видна, подсвечена, поле сохраняет фокус |
| №9 Фильтр | 8 → 1 | Название и путь, в том числе `012` и `5` |
| №1 Открытие папки | 9 | Та же сохранённая позиция, что через недавние |
| №7 Подсказки | 10; использование 1, 4–6, 11 | Единая тема, UI-шрифт, клавиатура и hotkey |
| №10 Рецензия | 11 + 4 | 30 записей читаемы и при ширине по умолчанию |
| №11 Сравнение | 12 | Тот же видимый абзац в обе стороны |
| №12 Undo | 13 | Середина слова/граница абзаца, текст и запись отменяются вместе |

Все новые файлы перечислены в соответствующей задаче. Общие UI-компоненты
живут в `renderer/ui`, helpers фильтра и позиции — рядом с потребителями.
Пути с префиксом `renderer/`, `main/`, `shared/`, `preload/` ниже относительны
к `apps/desktop/src/`; тесты с `tests/` — к корню репозитория.

## Task 1: Действия в оглавлении и меню конкретной главы

**Files:** Create `apps/desktop/src/renderer/book/ChapterSidebar.tsx`, `ChapterMenu.tsx`, `ChapterDialogs.tsx`, `RenameBookDialog.tsx`; Modify `BookWindow.tsx` в том же каталоге, `apps/desktop/src/renderer/app.css`; Remove `BookManagement.tsx` после переноса всех операций; Test `tests/desktop/book-management.spec.ts`, `packaged-management.spec.ts`.

**Interfaces:** Существующие `BookView`, `BookChange`, `ChapterDiscovery` из `shared/api.ts`.
```ts
export type ChapterAction =
  | { kind: 'create' | 'discover' | 'sort' }
  | { kind: 'remove' | 'trash'; chapterId: string };
export type ChapterSidebarProps = {
  book: BookView; activeId: string | null; disabled: boolean;
  onOpen(id: string): void; onAction(action: ChapterAction): void;
};
```
Обработчик BookWindow передаёт текущий flush+manageBook+refreshBook в диалоги как `onChange(change: BookChange): Promise<void>`. Меню хранит targetId явно, не читает activeId для удаления.

- [x] Переписать существующие native-тесты: создать/Discovery через иконки заголовка оглавления, удалить неактивную главу через её меню, отменить корзину; missing глава доступна для remove. Сохранить проверки sidecar, UUID, failed management и Undo. RED ожидается на новых accessible names.
```ts
const toc = page.getByRole('navigation', { name: 'Оглавление' });
await toc.getByRole('button', { name: 'Добавить главу', exact: true }).click();
await expect(page.getByRole('dialog', { name: 'Новая глава' })).toBeVisible();
```
- [x] Перенести фильтр/карточки в ChapterSidebar, сохранив `matchesChapter` и тесты Task 8. Карточка — контейнер с двумя соседними кнопками (открыть и меню), меню доступно hover/focus и постоянно различимо на активной строке. `aria-label` меню: `Действия главы: ${title || path}`; меню не переключает главу. Иконки создания/Discovery у заголовка получают общий Tooltip из Task 10 и aria-label; sort подключается Task 2.
- [x] Разделить прежний BookManagement на целевые диалоги. Сохранить busy/error и подтверждение корзины; rename книги остаётся в меню книги. Discovery обновляет список по явному действию/возврату фокуса открытого диалога, не запускает скрытое добавление. После ошибки partial trash выполнить прежний refresh. Фокус возвратить инициатору, а после удаления карточки — ближайшей главе либо заголовку.
- [x] Удалить старый пункт «Управление книгой», select выбора главы и стили универсального диалога, заменить селекторы прежних тестов. Нет ослабления ожиданий сохранения.
- [x] Package; запустить оба management spec через Xvfb/runbook, проверить typecheck. Commit `feat(ux): move chapter actions into the table of contents`.

## Task 2: Явная сортировка spine

**Files:** Modify `packages/book-storage/src/book.ts`, `apps/desktop/src/shared/api.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/renderer/book/ChapterDialogs.tsx`; Create `apps/desktop/src/renderer/book/chapter-order.ts`, `chapter-order.test.ts`; Test `packages/book-storage/src/management.test.ts`, `apps/desktop/src/main/ipc.test.ts`, `book-service.test.ts`, `tests/desktop/book-management.spec.ts`.

**Interfaces:** Расширить обе существующие BookChange-унионы одним вариантом:
```ts
{ type: 'reorder'; chapterIds: string[] }
```
Create `sortedChapterIds(entries: BookView['entries'], by: 'path' | 'title'): string[]` в chapter-order.ts. Storage принимает полную перестановку существующих ID, не алгоритм сортировки.

`main/book-service.ts` проверить: существующий общий manage-путь уже сохраняет
сессии для reorder; изменение production-кода нужно только при обнаружении
нарушения этого контракта. Регрессионный тест service обязателен.

- [x] Написать unit-тесты натурального порядка `2.md` перед `10.md`, одинаковых названий и пустого title (fallback path). Storage-тест: правильная перестановка меняет только chapters order; duplicate/unknown/missing ID отвергается, stale manifest не перезаписывается. Сохранить missing главы в перестановке.
```ts
const ids = change.chapterIds;
const current = book.manifest.chapters.map(chapter => chapter.id);
const valid = ids.length === current.length && new Set(ids).size === ids.length
  && ids.every(id => current.includes(id));
if (!valid) throw new BookManagementError('Некорректный порядок глав');
```
- [x] Выполнить `npx vitest run packages/book-storage/src/management.test.ts apps/desktop/src/main/ipc.test.ts apps/desktop/src/renderer/book/chapter-order.test.ts`; подтвердить RED нового типа/операции.
- [x] Добавить reorder в main validation и storage management queue; использовать текущий optimistic manifest check и atomic replacement. Если IDs уже в том же порядке — no-op после проверки актуальности. MD/sidecar не писать. Book-service сохраняет живые сессии, activeChapter и историю ввода при перестановке.
- [x] В renderer вычислить порядок через `new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' })`; сохранять исходный индекс для равных ключей. Иконка сортировки открывает выбор ключа и preview всех глав, подтверждение отправляет IDs. При действующем фильтре явно сказать, что сортируется вся книга.
- [x] Native: активировать главу, создать правку, отфильтровать список, подтвердить сортировку; сверить весь manifest, неизменность sidecar/MD, активную главу, Undo и порядок после reopen. Отмена preview ничего не пишет. Повторить unit/typecheck; commit `feat(book): reorder chapters without changing files`.

## Task 3: Сохраняемые настройки ширины без гонок settings.json

**Files:** Create `apps/desktop/src/shared/layout.ts`; Modify `shared/api.ts`, `main/settings.ts`, `main/book-service.ts`, `main/ipc.ts`, `preload/index.ts`; Test `main/settings.test.ts`, `main/ipc.test.ts`.

**Interfaces:**
```ts
export type LayoutSettings = { chaptersWidth: number; reviewWidth: number };
export const DEFAULT_LAYOUT: LayoutSettings = { chaptersWidth: 315, reviewWidth: 336 };
export const SIDEBAR_BOUNDS = { min: 240, max: 560 } as const;
// DeskApi:
// layout(): Promise<LayoutSettings>
// setLayout(value: LayoutSettings): Promise<void>
// settings.ts:
// validateLayout(value: unknown): LayoutSettings
// saveLayout(appData: string, value: LayoutSettings): Promise<void>
```
DeskSettings получает layout; старые настройки подхватывают defaults независимо от appearance/positions.

- [x] Добавить тесты defaults/migration, дробей/NaN/out-of-range, перезапуска. Детерминированно задержать read settings и вызвать одновременно saveLayout, saveAppearance, savePosition: ни один блок не теряется.
```ts
await Promise.all([
  saveLayout(root, { chaptersWidth: 400, reviewWidth: 360 }),
  saveAppearance(root, appearance),
  savePosition(root, 'book', 'chapter', 12, 340),
]);
const saved = await loadSettings(root);
expect(saved.layout).toEqual({ chaptersWidth: 400, reviewWidth: 360 });
expect(saved.appearance).toEqual(appearance);
expect(saved.positions.book.chapter).toEqual({ anchor: 12, scrollTop: 340 });
```
`root` — temp profile; `appearance` — валидная копия DEFAULT_APPEARANCE с изменённым fontSize.
- [x] Запустить `npx vitest run apps/desktop/src/main/settings.test.ts`, подтвердить RED.
- [x] Сериализовать полный read-modify-write для каждого appData через существующий SaveQueue, включая appearance и positions. Не ставить очередь лишь вокруг rename: это не предотвращает lost update. Пути существующих callers должны использовать одну очередь на профиль. Ошибка записи не отравляет очередь. Проверять layout в main; IPC sender validation без изменений.
- [x] Прогнать settings/ipc/service tests и typecheck. Commit `feat(settings): persist sidebar widths with serialized updates`.

## Task 4: Перетаскиваемые границы и узкие окна

**Files:** Create `apps/desktop/src/renderer/book/SidebarResizer.tsx`, `layout.ts`, `layout.test.ts`; Modify `renderer/App.tsx`, `renderer/book/BookWindow.tsx`, `renderer/app.css`; Create `tests/desktop/sidebar-layout.spec.ts`.

**Interfaces:** consumes LayoutSettings + DeskApi.layout/setLayout.
```ts
export type EffectiveLayout = {
  chaptersWidth: number; reviewWidth: number;
  chaptersCollapsed: boolean; reviewCollapsed: boolean;
};
export function fitLayout(preferred: LayoutSettings, availableWidth: number): EffectiveLayout;
export type SidebarResizerProps = {
  side: 'chapters' | 'review'; value: number;
  onPreview(value: number): void; onCommit(value: number): void;
  onCancel(): void;
};
```
availableWidth — ширина grid content box; вычесть по 6 px на видимый разделитель.

- [x] Unit fitLayout: 1920 сохраняет defaults, 1100 уменьшает панели до допустимого, 900 скрывает review, 700 скрывает обе; значения пользователя не мутируются. Native-тест: drag, клавиатура, отмена, перезапуск и независимость сторон.
- [x] Реализовать pointer capture: chapters = startWidth + deltaX, review = startWidth − deltaX; clamp по bounds и доступному месту. Escape/pointercancel восстанавливает исходную ширину без persist. Pointerup вызывает onCommit; arrows 16px, Home/End bounds, double-click default; серию клавиатурных изменений сохранять через 250 мс без ввода. Отключить выделение текста только на время drag, очистить обработчики при unmount.
- [x] Grid использует CSS variables; изменение ширины вызывает штатный reflow CodeMirror без remount. Сохранять preferred widths после commit через setLayout, не сохранять responsive clamp. Очередь renderer для setLayout не допускает перестановки ответов; ошибки видны, последняя ширина остаётся в памяти с возможностью повторить сохранение.
- [x] Добавить переключатели панелей: при нехватке ширины открывают overlay, иначе скрывают/показывают колонку. Overlay доступен с клавиатуры, закрывается снаружи/Escape; Zen не пишет layout. ResizeObserver считает реальную доступную ширину, включает возврат из узкого окна.
- [x] Native: сравнить ширину ±1px после restart, проверить отсутствие horizontal overflow на 900/1280/1920, активную selection и scroll при resize, UTF-8 sidecar неизменен. Прогнать typecheck/unit/native; commit `feat(ux): make sidebars resizable and persistent`.

## Task 5: Один верхний chrome

**Files:** Modify `renderer/TitleBar.tsx`, `renderer/App.tsx`, `renderer/book/BookWindow.tsx`, `renderer/app.css`; Test `tests/desktop/window-frame.spec.ts`, `search-and-appearance.spec.ts`, `close-pending.spec.ts`, `shell.spec.ts`.

**Interfaces:**
```ts
// TitleBar accepts book controls without knowing book-service state.
type TitleBarProps = { title: string; children?: React.ReactNode };
```
App рендерит TitleBar только на welcome; BookWindow рендерит один TitleBar со своими controls. Не переносить editor state в App и не дублировать chrome через portal.

- [x] Изменить native-тест: ровно один header.titlebar, высота 44px, нет отдельного book__header; все кнопки доступны при 900px; на welcome прежняя прокрутка недавних. Сохранить проверки maximize/restore/minimize/close.
- [x] Переместить controls из book__header в children TitleBar, а titlebar controls оставить справа. Добавить `min-width:0`, ellipsis title, flex-nowrap; interactive group получает `-webkit-app-region:no-drag`, остальная часть — drag. Отдельные error/external banners остаются вне draggable header.
- [x] При <1100px переместить редкие действия в меню, не дублируя tab stops; поиск показывать отдельной строкой только когда открыт. Обновить положение Appearance относительно trigger вместо прежнего top:58px. Zen оставляет системные controls и видимую кнопку выхода в TitleBar даже при <1100px; сочетание Task 7 продолжает работать, Escape не выходит из Zen.
- [x] Проверить Linux X11 dragging через xdotool, двойной клик пустой зоны, клики кнопок не тянут окно; macOS inset 82px и отсутствие custom Linux controls. Закрытие по-прежнему проходит book/renderer flush.
- [x] Прогнать четыре указанных desktop spec, theme screenshots 900/1920. Commit `feat(ux): unify title bar and book toolbar`.

## Task 6: Метаданные под иконкой

**Files:** Modify `renderer/book/Metadata.tsx`, `BookWindow.tsx`, `renderer/app.css`; Create `renderer/book/MetadataPopover.tsx`; Test `tests/desktop/metadata.spec.ts`, `close-pending.spec.ts`.

**Interfaces:** Существующие Metadata.source/readOnly/onSave/onEditing сохраняются. MetadataPopover управляет open/dirty/saving и фокусом; `onSave(yaml: string, source: string): Promise<void>` сохраняет текущую optimistic проверку.

- [x] Переписать metadata native-тест: сначала только кнопка «Метаданные главы», YAML скрыт; popover открывается клавиатурой и получает focus. Добавить dirty dismissal, failed save, readonly, invalid YAML, смену главы и восстановление focus/scroll.
```ts
await expect(page.getByLabel('YAML метаданных')).toHaveCount(0);
await page.getByRole('button', { name: 'Метаданные главы', exact: true }).click();
await expect(page.getByRole('dialog', { name: 'Метаданные главы' })).toBeVisible();
```
- [x] Убрать Metadata из постоянного потока book__content, поставить trigger справа от chapter title. Рендерить прежний редактор YAML внутри anchored dialog шириной min(560px, viewport−32px), max-height viewport−80px, overflow auto. В read-only показывать YAML без редактирования; malformed YAML обозначать на trigger без вывода текста в редактор книги.
- [x] Dirty = draft.yaml !== original.yaml. Escape/outside/смена главы запрашивают discard внутри попапа; saving блокирует dismissal. При подтверждении очистить draft и onEditing(false), вернуть focus инициатору. При failure оставить draft/error. Не добавлять автоматическую запись YAML при закрытии. Сохранить warning об очистке Undo и передачу исходного sourceText.
- [x] Прогнать metadata и close-pending native; проверить body start protection, BOM/CRLF, источники без frontmatter и конфликт внешнего изменения. Commit `feat(ux): move chapter metadata into a focused popover`.

## Task 7: Отдельное переключение Zen (история №6)

**Files:** Modify `renderer/book/BookWindow.tsx`, `tests/desktop/search-and-appearance.spec.ts`; Create `renderer/book/shortcuts.ts`, `renderer/book/shortcuts.test.ts`.

**Interfaces:** `isZenShortcut(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'>, platform: NodeJS.Platform): boolean`. Платформу брать из существующего windowState. Все три инициатора (кнопка, меню, shortcut) вызывают один toggle с существующими действиями enterZen.

- [x] RED: в native-тесте войти в Zen, нажать Escape дважды и проверить `.book--zen`; открыть поиск и popup, закрыть Escape, проверить Zen. В unit проверить Linux/macOS, repeat, composition, русскую раскладку (code=KeyZ), лишние модификаторы и сохранение Ctrl/Cmd+Shift+Z для Redo.
```ts
await page.getByRole('button', { name: 'Режим Zen', exact: true }).click();
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await expect(page.locator('.book--zen')).toBeVisible();
```
- [x] Убрать выход из Escape-ветки, обновить комментарии и текст «Выйти из Zen (Esc)». Добавить shortcut guard:
```ts
return !event.repeat && !event.isComposing && event.code === 'KeyZ'
  && event.altKey && !event.shiftKey
  && (platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
```
При совпадении preventDefault; модальные формы блокируют toggle. Вход/выход не отбрасывает dirty draft. Escape остаётся обработкой верхнего слоя. Task 10 добавит отдельную строку shortcut в Tooltip.
- [x] Прогнать `npx vitest run apps/desktop/src/renderer/book/shortcuts.test.ts`, typecheck, package и search-and-appearance native. Проверить комбинацию с фокусом в редакторе и поиске на обеих платформах; повторить после Tasks 4–6. Commit `fix(ux): decouple Zen from Escape`.

## Task 8: Первая находка и фильтр по пути (истории №8, №9)

**Files:** Modify `renderer/search/ChapterSearch.tsx`, `renderer/book/BookWindow.tsx`, `renderer/editor/ReviewEditor.tsx`, `tests/desktop/search-and-appearance.spec.ts`; Create `renderer/book/chapter-filter.ts`, `renderer/book/chapter-filter.test.ts`; Test `renderer/search/search.test.ts`.

**Interfaces:** `matchesChapter(entry: Pick<Entry, 'title' | 'path'>, query: string): boolean`. Сохранить `SearchRange`, `findLiteral` и `derivedRangeToDisplayRange`; поисковое выделение отделить от фокуса редактора. `ChapterSearch` получает `chapterId: string`, чтобы отличать смену главы от новой ревизии.

- [x] RED: запрос с первым совпадением ниже viewport сразу показывает 1/N, видимый highlight и focus в поле. Продолжить печать ещё одним символом. Проверить Текст/Сравнение/Исходник, next/previous, пустой запрос, no-match, смену главы и ревизии. Фильтр: название, путь, регистр, пробелы, `012`, `5`, missing и пустая строка.
```ts
export function matchesChapter(entry: Pick<Entry, 'title' | 'path'>, query: string): boolean {
  const key = query.trim().toLocaleLowerCase('ru');
  return [entry.title, entry.path].some(value => value.toLocaleLowerCase('ru').includes(key));
}
```
- [x] Запустить новый unit-тест и native search spec, подтвердить RED. В BookWindow заменить title-only predicate на helper; в Task 1 перенести вызов вместе с карточками.
- [x] В ChapterSearch при изменении query/chapterId/area сбрасывать active=0 и вызывать onReveal(results[0]) после готовности целевого view. Не ставить нестабильный onReveal или каждую snapshot revision причиной повторного перехода. Новая ревизия только пересчитывает результаты/clamp active; next/previous использует актуальные ranges.
- [x] Для пустого запроса/no-match снять только поисковое выделение. Если текущий revealRange перемещает focus или создаёт flyout, расширить API опцией `options?: { focus?: boolean }` и добавить `clearSearchHighlight(): void`; поисковый путь вызывает revealRange с `{ focus: false }`, навигация к записи сохраняет прежнюю семантику. Для DOM-представлений очищать собственную search decoration, не пользовательскую selection. Не менять модель данных/историю ввода.
- [x] GREEN: `npx vitest run apps/desktop/src/renderer/book/chapter-filter.test.ts apps/desktop/src/renderer/search/search.test.ts`, typecheck, package, native search spec. Проверить неизменность MD/sidecar. Commit `fix(ux): reveal search matches and filter chapter paths`.

## Task 9: Одинаковое восстановление через выбор папки (история №1)

**Files:** Modify `shared/api.ts`, `main/recent-books.ts`, `main/recent-books.test.ts`, `renderer/book/RecentBooks.tsx`, `renderer/book/BookWindow.tsx`, `renderer/App.tsx`, `tests/desktop/open-book.spec.ts`, `tests/desktop/search-and-appearance.spec.ts`; Test `main/book-service.test.ts`.

**Interfaces:** добавить обязательный `bookId: string` в renderer-visible `Recent`, заполнить в toRecentViews; обновить typed fixtures. BookView уже содержит bookId. Форматы manifest/sidecar/recent-books.json не меняются.

- [x] RED: сохранить главу не первую и прокрутку, закрыть приложение, снова запустить в том же временном профиле и выбрать ту же папку через dialog. Сравнить главу/видимый абзац с открытием через «Недавние» в отдельном перезапуске. Проверить cancel, новую книгу, moved folder с тем же bookId, removed/missing последнюю главу и книгу без доступных глав.
- [x] После успешного chooseBook перечитать recent (main уже upsert-ит запись с сохранённой позицией), затем сопоставить по bookId:
```ts
const latest = await window.desk.recent();
const recent = latest.find(entry => entry.bookId === book.bookId);
onOpen(book, recent);
```
Обработать отказ recent отдельно: уже открытая книга всё равно передаётся onOpen без restore, App принимает необязательное предупреждение открытия и показывает его в окне книги; не оставлять скрытую открытую сессию. Не выбирать первую запись recent или совпадение title.
- [x] В BookWindow проверять восстановленный и cached chapterId на существование **и !missing**; fallback firstOpenEntryId без особого правила для `_index.md`. Использовать существующий ReadingRestore и сохранение позиции.
- [x] GREEN: `npx vitest run apps/desktop/src/main/recent-books.test.ts apps/desktop/src/main/book-service.test.ts`, typecheck, package и оба native spec. Проверить первый запуск, где загрузка welcome recents ещё не завершилась. Commit `fix(ux): restore reading position when choosing a known folder`.

## Task 10: Общий Tooltip (история №7)

**Files:** Create `renderer/ui/Tooltip.tsx`, `renderer/ui/tooltip-controller.ts`, `tests/desktop/tooltips.spec.ts`; Modify `renderer/app.css`, `renderer/TitleBar.tsx`, `renderer/book/BookWindow.tsx`, `renderer/search/ChapterSearch.tsx`, `renderer/appearance/Appearance.tsx`, `renderer/editor/ComparisonView.tsx`, `renderer/editor/markers.ts`, `renderer/review/ReviewList.tsx`. Дополнительно мигрировать оставшиеся найденные title-подсказки в `apps/desktop/src/renderer`.

**Interfaces:**
```ts
export type TooltipProps = {
  content: React.ReactNode;
  shortcut?: string;
  children: React.ReactElement;
};
// Для DOM widgets редактора: один controller и тот же themed tooltip host.
export function attachTooltip(target: HTMLElement, content: string, shortcut?: string): () => void;
```
Tooltip использует один trigger, не создаёт вложенную кнопку; cleanup снимает DOM listeners и таймер. Сохраняет исходные ref/handlers/aria-describedby trigger.

- [x] RED: hover/focus показывает role=tooltip, blur/Escape скрывает; native title отсутствует. Проверить Theme/UI-font, отдельную строку shortcut Zen, disabled button wrapper без лишнего tab stop, marker и край viewport.
```ts
await page.getByRole('button', { name: 'Режим Zen', exact: true }).focus();
await expect(page.getByRole('tooltip')).toBeVisible();
await expect(page.getByRole('tooltip')).toContainText('Alt');
```
- [x] Реализовать portal host внутри контейнера, наследующего app theme/UI font: hover 300 мс, focus сразу, viewport clamp 8px, role=tooltip/id + aria-describedby, pointer-events:none и no-drag. При unmount/scroll/смене view скрыть и очистить timers; не красть focus. Escape для tooltip не глушит обработку активного слоя.
- [x] Инвентаризация: `rg -n 'title=|\.title\s*=|setAttribute\(.title' apps/desktop/src/renderer`. Перенести подсказки React и DOM widgets через общий controller; сохранить SVG title и поля данных. Новые Tasks 1/4/5/6/11 используют только этот компонент. Финальный остаток инвентаризации с объяснением исключений включить в evidence.
- [x] Typecheck, package, tooltips и search-and-appearance native; screenshots light/dark, 125%, hover и keyboard focus. Commit `feat(ux): use themed tooltips across the workspace`.

## Task 11: Читаемый список рецензии (история №10)

**Files:** Modify `renderer/review/ReviewList.tsx`, `renderer/app.css`, `tests/desktop/review-actions.spec.ts`; Test `tests/desktop/sidebar-layout.spec.ts` из Task 4.

**Interfaces:** существующие props ReviewList/onSelect/onCommand и recordsInReadingOrder сохраняются; Tooltip из Task 10. Не создавать вторую модель записей или новый IPC.

- [x] RED: disk-backed глава с 30 записями, длинными before/after, вставкой, удалением, сигналом, conflicting/unavailable; widths 240/336/560. До клика видны обе части правки и статус; список не вызывает горизонтальную прокрутку. Клик и Enter всё ещё переходят к якорю/открывают карточку.
- [x] Разметить summary отдельными блоками «Было»/«Стало» с максимум тремя строками каждого; сигнал — тип + комментарий до трёх строк. Пустой before/after обозначает вставку/удаление. Статус вынести за обрезаемый текст, сохранить полный accessible name.
```css
.book__record-summary { min-width: 0; white-space: normal; }
.book__record-excerpt {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
}
```
- [x] Общий Tooltip показывает полный текст на hover/focus в пределах viewport; существующая карточка остаётся доступом к очень длинному тексту и действиям. Не менять порядок/selection при resize, не скрывать conflict label. Применить/Отклонить, маркеры на полях и read-only сохраняются.
- [x] Typecheck, package, review-actions и sidebar-layout native; на копии реальной книги просмотреть 30 записей при default width и сохранить снимок. Commit `feat(ux): make dense review lists readable`.

## Task 12: Позиция чтения при сравнении (история №11)

**Files:** Create `renderer/editor/reading-position.ts`, `renderer/editor/reading-position.test.ts`; Modify `renderer/editor/ReviewEditor.tsx`, `renderer/editor/ComparisonView.tsx`, `renderer/book/BookWindow.tsx`, `renderer/search/search.ts`, `renderer/search/search.test.ts`; Create `tests/desktop/comparison-position.spec.ts`.

**Interfaces:**
```ts
export type ViewportAnchor = { derivedOffset: number; topOffset: number };
// Добавить в ReviewEditorApi:
// captureViewport(): ViewportAnchor | null
// restoreViewport(anchor: ViewportAnchor): boolean
// Добавить в reading-position.ts (ComparisonSegment импортируется из search.ts):
export function displayOffsetToDerived(segments: readonly ComparisonSegment[], offset: number): number | null;
```
Существующий derivedRangeToDisplayRange переводит anchor в сравнение. Обратный helper использует те же segments, для before части возвращает derivedFrom, для after — соответствующее смещение; EOF/пустой документ определены явно. DOM marker buttons исключаются из текстовых координат.

- [x] RED unit: до/внутри/после вставки, удаления и замены; кириллица/emoji, EOF, нулевая длина after. Native: прокрутить без перемещения caret к середине длинной главы, переключить Текст → Сравнение, проверить тот же видимый фрагмент и вертикальное положение ± высота строки; прокрутить сравнение дальше и вернуться. Глава без правок, YAML, 125%, resize, pending edits также покрыты.
- [x] Реализовать captureViewport по первой видимой строке CodeMirror и её координате относительно scroller; DOM сравнения получает явные derived/display границы текстовых spans из buildComparisonPieces. Не использовать textContent всего DOM с символами маркеров для обратного mapping.
- [x] switchMode до flush снимает anchor текущего представления, после успешного flush и готовности нового layout восстанавливает его один раз. Не монтировать новый view при ошибке flush. Привязать отложенное восстановление к bookId/chapterId/целевому mode; отменять при новой навигации, не позволять позднему callback перезаписать позицию другой главы. Восстановление не меняет selection и не создаёт поисковую подсветку.
- [x] При закрытии/сохранении из сравнения хранить последний корректный text scrollTop и актуальный derived anchor; при возврате/повторном открытии anchor имеет приоритет над устаревшими пикселями. При apply/отклонении правки clamp/rebase anchor по актуальному snapshot. Проверить отсутствие записи display scrollTop как text scrollTop; source mode сохраняет прежнее поведение.
- [x] GREEN: `npx vitest run apps/desktop/src/renderer/editor/reading-position.test.ts apps/desktop/src/renderer/search/search.test.ts`, typecheck, package, comparison-position, search-and-appearance и close-pending native. Commit `fix(ux): preserve the reading viewport across comparison mode`.

## Task 13: Интеграционная приёмка и атомарный Undo (история №12)

**Files:** Update `docs/verification.md`, Create `docs/reviews/2026-09-17-workspace-ux.md`; Modify `tests/desktop/edit-and-reopen.spec.ts`, `tests/desktop/review-actions.spec.ts`; tests from Tasks 1–12.

- [x] Закрепить №12 двумя native-кейсами: отдельная завершённая группа ввода в середине слова и на границе абзаца. Снять исходный snapshot, ввести изменение, дождаться записи/flush, один Undo возвращает text и records к исходному состоянию (revision сравнивать не нужно), Redo возвращает изменение. Соседние записи неизменны. После Undo и flush/reopen проверить текст и декодированный sidecar, без требования восстановить стек Undo. Если тест уже проходит, записать регрессию без изменений production-кода.
- [x] Выполнить `npm test`, `npx tsc -b --force --pretty false`, `npm run package`, `npm run test:contracts` (reorder сохраняет Pocket manifest contract).
- [x] Изолированный полный Linux native-прогон по `docs/runbooks/release.md`; userData и книги только временные. Не закрывать пользовательский экземпляр.
- [x] Проверить матрицу light/dark × 900/1280/1920 × 100/125% и Zen. Сохранить снимки с обычной главой, sidebar menu, Discovery, sort preview, metadata popover, themed tooltip, поиск с первой находкой, плотная рецензия и сравнение на середине главы. В кадре одна верхняя строка, центр без отдельной «бумаги», действия не обрезаны.
- [x] Проверить пересечения: dirty metadata + remove chapter; resize + сохранение позиции; sort + фильтр; закрытие книги с pending edits; переход в Zen из попапа; двойной Escape в Zen; tooltip + Escape + поиск; автопоиск + смена view; сравнение + закрытие/reopen; две платформы без изменения data formats.
- [x] На временной копии реальной книги (20+ глав, YAML, 20–30 правок) пройти истории №1, 6–12 и записать результат отдельно для каждой со ссылками на screenshots/test evidence. Неподтверждённый баг подсветки активной главы из ревью не добавлять как исправление; сохранить обычную регрессию. Отсутствие реальной книги/доступа к macOS отмечать как непроведённую проверку, не PASS. Все auto/native-команды выполняются по runbook в изолированном профиле; установленное приложение не обновлять.
- [x] Записать фактические PASS/FAIL и отдельно старый отложенный macOS selection failure. Не повышать таймауты/не добавлять retries ради зелёного результата. Commit `docs: record workspace UX acceptance`.

Приёмка выполнена на Linux/Xvfb; macOS и системный IME не проверены. Полные результаты и ограничения: `docs/reviews/2026-09-17-workspace-ux.md`.
