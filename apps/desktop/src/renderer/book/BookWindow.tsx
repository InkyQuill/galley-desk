import { ChapterSidebar } from './ChapterSidebar';
import type { ChapterAction } from './ChapterSidebar';
import { ChapterDialogs } from './ChapterDialogs';
import { RenameBookDialog } from './RenameBookDialog';
import { MetadataPopover } from './MetadataPopover';
import type { MetadataPopoverHandle } from './MetadataPopover';
import { IconSearch, IconFileText, IconColumns2, IconCode, IconTarget, IconTargetOff, IconDots, IconAdjustments, IconBookOff, IconPencil, IconInfoCircle, IconX, IconLayoutSidebar, IconLayoutSidebarRight } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import type { AppearanceSettings, BookView, Command, RecordView, Snapshot } from '../../shared/api';
import type { ThemeDefinition } from '@inkyquill/galley-themes';
import { captureComparisonViewport, restoreComparisonViewport, comparisonTextRange, rebaseViewport } from '../editor/reading-position';
import type { ViewportAnchor } from '../editor/reading-position';
import { comparisonSegments, ComparisonView } from '../editor/ComparisonView';
import type { ReviewEditorApi } from '../editor/ReviewEditor';
import { ReviewEditor } from '../editor/ReviewEditor';
import { setActiveScheme } from '../editor/markers';
import type { SignalTypeName } from '../editor/markers';
import { Appearance, contentWidthStyle } from '../appearance/Appearance';
import { derivedRangeToDisplayRange } from '../search/search';
import type { SearchRange } from '../search/search';
import { ChapterSearch } from '../search/ChapterSearch';
import { ChapterNote } from '../review/ChapterNote';
import { RecordPopup } from '../review/RecordPopup';
import type { PopupPosition } from '../review/RecordPopup';
import { ReviewList } from '../review/ReviewList';
import { SignalFlyout } from '../review/SignalFlyout';
import { isZenShortcut, zenShortcutLabel } from './shortcuts';
import { Tooltip } from '../ui/Tooltip';
import type { LayoutSettings } from '../../shared/layout';
import { SIDEBAR_BOUNDS } from '../../shared/layout';
import { CENTER_MIN_WIDTH, RESIZER_WIDTH, fitLayout } from './layout';
import { SidebarResizer } from './SidebarResizer';
import { TitleBar } from '../TitleBar';

type Props = {
  book: BookView;
  /** Сохранённая позиция из записи недавних (восстановление после перезапуска). */
  restore?: ReadingRestore | null;
  /** Предупреждение открытия (например, recent() не ответил после выбора
   * папки диалогом) — книга уже открыта, но без восстановления позиции. */
  openWarning?: string | null;
  onClose: () => void;
  onBookChange?: (book: BookView) => void;
  /** Настройки оформления: источник — App (один тематический контейнер). */
  appearance: AppearanceSettings;
  /** Резолв темы в App («Системная» уже развёрнута по схеме ОС). */
  appearanceTheme: ThemeDefinition;
  /** Ошибка применения настроек (сбой загрузки/отказ main) — панель показывает. */
  appearanceError: string | null;
  /** Изменение из панели: App применяет на контейнере и сохраняет в appData. */
  onAppearanceChange: (next: AppearanceSettings) => void;
  layout: LayoutSettings;
  layoutError: string | null;
  onLayoutChange: (next: LayoutSettings) => void;
  onLayoutRetry: () => void;
};

/** Позиция чтения для восстановления при открытии книги. */
export type ReadingRestore = { chapterId: string; scrollTop: number; anchor?: number | null };

// Восстановление главы и прокрутки при повторном открытии книги в этом окне;
// между запусками позицию сохраняет основной процесс (desk.savePosition).
const positionCache = new Map<string, { chapterId: string; scrollTop: number; anchor: number; viewport?: ViewportAnchor }>();

const SAVE_DEBOUNCE_MS = 200;

const SAVE_STATE_LABELS: Record<Snapshot['saveState'], string> = {
  saved: 'Сохранено',
  saving: 'Сохраняется',
  error: 'Ошибка сохранения',
  external: 'Внешнее изменение',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Операция не выполнена';
}

/**
 * Выделяет диапазон [from, to) в конкатенированных текстовых узлах контейнера
 * и прокручивает к нему (виды «Сравнение» и «Исходник» — обычный DOM).
 */
function revealTextOffset(container: HTMLElement, from: number, to: number): void {
  const comparisonRange = container.matches('.book__comparison') ? comparisonTextRange(container, from, to) : null;
  if (container.matches('.book__comparison') && comparisonRange === null) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let start: { text: Text; offset: number } | null = null;
  let end: { text: Text; offset: number } | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const next = consumed + text.data.length;
    if (start === null && from < next) start = { text, offset: from - consumed };
    if (end === null && to <= next) end = { text, offset: to - consumed };
    consumed = next;
    if (start !== null && end !== null) break;
  }
  if (comparisonRange === null && (start === null || end === null)) return;
  const range = comparisonRange ?? document.createRange();
  if (comparisonRange === null && start !== null && end !== null) {
    range.setStart(start.text, Math.max(0, Math.min(start.offset, start.text.data.length)));
    range.setEnd(end.text, Math.max(0, Math.min(end.offset, end.text.data.length)));
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  // Центрируем находку в самом контейнере, а не полагаемся на
  // parentElement.scrollIntoView: в «Исходнике» текстовые узлы — прямые дети
  // скроллируемого <pre> (parentElement === container), и scrollIntoView на
  // самом себе не двигает его собственный scrollTop -- находка оставалась
  // визуально вне viewport, хотя и была выделена.
  const rangeRect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  container.scrollTop += rangeRect.top - containerRect.top - containerRect.height / 2 + rangeRect.height / 2;
}

function firstOpenEntryId(book: BookView): string | null {
  const open = book.entries.find((entry) => !entry.missing);
  return open?.id ?? book.entries[0]?.id ?? null;
}

/**
 * Восстановленная/кэшированная глава годится только если она всё ещё есть в
 * оглавлении и не помечена отсутствующей — состав оглавления определяет
 * автор, поэтому здесь нет отдельного правила для `_index.md` или любого
 * другого id: проверка одна и та же для всех записей.
 */
function isSelectableEntry(book: BookView, chapterId: string | null | undefined): chapterId is string {
  if (chapterId == null) return false;
  const entry = book.entries.find((candidate) => candidate.id === chapterId);
  return entry !== undefined && !entry.missing;
}

/** Прямоугольник маркера/курсора в viewport-координатах (попап позиционируется fixed). */
type AnchorRect = { x: number; y: number; bottom: number };

type ViewMode = 'text' | 'comparison' | 'source';
type ViewportRestore = { bookId: string; chapterId: string; mode: ViewMode; anchor: ViewportAnchor; navigation: number };

function matchingViewport(ticket: ViewportRestore | null, bookId: string, chapterId: string | null, mode: ViewMode, navigation: number): ViewportAnchor | null {
  return ticket !== null && ticket.bookId === bookId && ticket.chapterId === chapterId && ticket.mode === mode && ticket.navigation === navigation ? ticket.anchor : null;
}

/** Открытая карточка: существующая запись у якоря или черновик сигнала. */
type PopupState =
  | { kind: 'record'; id: string; at: PopupPosition }
  | { kind: 'draft'; from: number; to: number; signalType: SignalTypeName; at: PopupPosition }
  | null;

/**
 * Рабочее окно книги: оглавление, глава в виде «Текст» (редактор Galley),
 * «Сравнение» (read-only источник с парами old/new и применением) или
 * «Исходник» (немаркированный raw Markdown), справа — навигация по рецензии:
 * список записей и заметка главы. Попапы записи и flyout типа сигнала живут
 * здесь; панели принадлежат только список и карточки без якоря — без форм.
 * Плюс: поиск по главе (область зависит от вида), фильтр оглавления
 * (только отображение, манифест не меняется), режим Zen (панели и topbar
 * скрыты, постоянная кнопка выхода; переключается кнопкой, пунктом меню или
 * Ctrl/Cmd+Alt+Z -- Escape его никогда не переключает, только закрывает
 * верхние слои вроде popup) и настройки оформления (панель в окне; тема/шрифт
 * живут на контейнере App, в книгах не пишут).
 */
export function BookWindow({
  book: initialBook,
  restore = null,
  openWarning = null,
  onClose,
  onBookChange,
  appearance,
  appearanceTheme,
  appearanceError,
  onAppearanceChange,
  layout,
  layoutError,
  onLayoutChange,
  onLayoutRetry,
}: Props) {
  const [book, setBook] = useState(initialBook);
  const [chapterAction, setChapterAction] = useState<ChapterAction | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const [openWarningDismissed, setOpenWarningDismissed] = useState(false);
  const cached = positionCache.get(book.bookId);
  // Сохранённая позиция из записи недавних сильнее внутрисессионного кэша;
  // глава могла исчезнуть из манифеста или стать missing — тогда
  // восстановление игнорируется (см. isSelectableEntry).
  const validRestore = restore !== null && isSelectableEntry(book, restore.chapterId) ? restore : null;
  const validCached = cached !== undefined && isSelectableEntry(book, cached.chapterId) ? cached : undefined;
  const [chapterId, setChapterId] = useState<string | null>(
    validRestore?.chapterId ?? validCached?.chapterId ?? firstOpenEntryId(book),
  );
  // Актуальная глава вне React-потока: поздние ack и снимки сравниваются с
  // ней, а не с устаревшим замыканием (гон смены главы, см. applySnapshot).
  const chapterIdRef = useRef<string | null>(chapterId);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [metadataEditing, setMetadataEditing] = useState(false);
  const metadataRef = useRef<MetadataPopoverHandle>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // Зеркало показанного снимка для решений вне React-потока (чип сбоя
  // сохранения при внешнем изменении — см. handleCommand).
  const snapshotRef = useRef<Snapshot | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('text');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const navigationRef = useRef(0);
  const captureViewportRef = useRef<() => ViewportAnchor | null>(() => null);
  const lastTextScrollRef = useRef(validRestore?.scrollTop ?? validCached?.scrollTop ?? 0);
  const initialViewportOffset = validRestore?.anchor ?? validCached?.anchor;
  const viewportRef = useRef<ViewportAnchor | null>(initialViewportOffset == null ? null :
    validCached?.chapterId === chapterId && validCached?.viewport?.derivedOffset === initialViewportOffset ? validCached.viewport : { derivedOffset: initialViewportOffset, topOffset: 0 });
  const pendingViewport = useRef<ViewportRestore | null>(
    chapterId !== null && viewportRef.current !== null ? { bookId: book.bookId, chapterId, mode: 'text', anchor: viewportRef.current, navigation: 0 } : null,
  );
  // Эпоха редактора: явная команда «Перечитать» пересоздаёт редактор из
  // сняка сессии (принудительная ресинхронизация после сбоя сохранения).
  const [editorEpoch, setEditorEpoch] = useState(0);
  const textRef = useRef<HTMLDivElement | null>(null);
  const comparisonRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLPreElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Поисковая подсветка в DOM-видах (Сравнение/Исходник) — window.getSelection,
  // тот же примитив, что и обычное выделение мышью в read-only тексте. Флаг
  // отличает «это выделение поставил поиск» от ручного выбора пользователя,
  // чтобы снятие подсветки не стирало чужое выделение (mousedown сбрасывает).
  const searchHighlightActiveRef = useRef(false);
  const anchorRef = useRef<number>(validRestore?.anchor ?? validCached?.anchor ?? 0);
  const pendingScroll = useRef<number | null>(viewportRef.current === null ? validRestore?.scrollTop ?? validCached?.scrollTop ?? null : null);
  // Ревизии последнего подтверждения по главам: expectedRevision берётся из
  // последнего ack, а не из устаревшего замыкания React.
  const revisionsRef = useRef(new Map<string, number>());

  // Flyout выделения, попап записи/черновика сигнала и карточка панели.
  const [flyout, setFlyout] = useState<{ from: number; to: number; x: number; y: number; bottom: number } | null>(null);
  const [popup, setPopup] = useState<PopupState>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [editorApi, setEditorApi] = useState<ReviewEditorApi | null>(null);
  // Панель оформления открыта локально; сами настройки живут в App — их
  // изменение доезжает до тематического контейнера мгновенно и сохраняется
  // там же через DeskApi.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const chaptersButtonRef = useRef<HTMLButtonElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayPanelRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(() => window.innerWidth);
  const [layoutPreview, setLayoutPreview] = useState<LayoutSettings | null>(null);
  const [chaptersHidden, setChaptersHidden] = useState(false);
  const [reviewHidden, setReviewHidden] = useState(false);
  const [sidebarOverlay, setSidebarOverlay] = useState<'chapters' | 'review' | null>(null);

  useEffect(() => {
    const element = bodyRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setAvailableWidth(width);
    });
    observer.observe(element);
    setAvailableWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sidebarOverlay === null) return;
    requestAnimationFrame(() => overlayPanelRef.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus());
    const dismiss = (event: PointerEvent): void => {
      if (overlayPanelRef.current?.contains(event.target as Node)) return;
      const side = sidebarOverlay;
      setSidebarOverlay(null);
      requestAnimationFrame(() => (side === 'chapters' ? chaptersButtonRef : reviewButtonRef).current?.focus());
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [sidebarOverlay]);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('.book__menu-items button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);
  useEffect(() => {
    if (searchOpen) document.querySelector<HTMLInputElement>('.book__search-input')?.focus();
  }, [searchOpen]);
  // Zen: панели и topbar скрыты; переключение отделено от Escape (см. секцию
  // «Zen и порядок Escape» ниже по файлу) -- кнопка/меню/Ctrl+Alt+Z дают один
  // toggle, Escape по-прежнему закрывает popup/flyout/карточку, но Zen не трогает.
  const [zen, setZen] = useState(false);
  // Платформа для guard'а shortcut'а (Ctrl+Alt+Z / Cmd+Alt+Z) -- источник
  // тот же windowState, что использует TitleBar; полностью инициализируется
  // до первого нажатия не гарантированно, поэтому shortcut просто не
  // сработает до прихода значения (нет платформы -- нет ложного толкования).
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  useEffect(() => {
    let active = true;
    void window.desk.windowState().then(state => { if (active) setPlatform(state.platform); }).catch(() => undefined);
    const unsubscribe = window.desk.onWindowState(state => { if (active) setPlatform(state.platform); });
    return () => { active = false; unsubscribe(); };
  }, []);
  // Функция фокуса flyout для Tab-пути из редактора (регистрирует SignalFlyout).
  const flyoutFocusRef = useRef<(() => void) | null>(null);
  const registerFlyoutFocus = useCallback((focus: (() => void) | null) => {
    flyoutFocusRef.current = focus;
  }, []);

  const applySnapshot = useCallback((next: Snapshot) => {
    revisionsRef.current.set(next.chapterId, next.revision);
    if (next.title) setTitles(current => ({ ...current, [next.chapterId]: next.title! }));
    // Поздний снимок чужой главы (пользователь уже переключился) не трогает
    // показанный документ: иначе редактор новой главы был бы пересоздан по
    // тексту прежней, а ввод новой главы ушёл бы в её сессию по смещённым
    // позициям (порча рукописи обычным «печатал и переключился»).
    if (next.chapterId !== chapterIdRef.current) return;
    // Локальный флаг ошибки сохранения снимается только явным действием
    // (успешная команда, «Перечитать главу», resolveExternal) — приход
    // снимка само по себе не прячет сбой и не принимает внешнюю версию.
    const previous = snapshotRef.current;
    if (modeRef.current === 'comparison' && previous !== null && previous !== next) {
      const anchor = matchingViewport(pendingViewport.current, next.bookId, next.chapterId, modeRef.current, navigationRef.current) ?? captureViewportRef.current() ?? viewportRef.current;
      if (anchor !== null) {
        const rebased = rebaseViewport(anchor, previous.text, next.text);
        viewportRef.current = rebased;
        pendingViewport.current = { bookId: next.bookId, chapterId: next.chapterId, mode: 'comparison', anchor: rebased, navigation: navigationRef.current };
      }
    }
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  /**
   * Смена главы: снимок прежней главы сбрасывается синхронно, до ответа
   * openChapter. Окно без снимка не показывает чужой текст: редактор
   * (key={chapterId}) и заметка главы ремонтируются только по снимку новой
   * главы, набранный в промежутке текст не уходит в чужую сессию.
   */
  const switchChapter = useCallback(async (next: string): Promise<void> => {
    if (next === chapterIdRef.current) return;
    ++navigationRef.current;
    pendingViewport.current = null;
    pendingScroll.current = null;
    if ((await metadataRef.current?.requestDismiss()) === false) return;
    try {
      await editorApi?.flushPending();
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    // A mode switch may have installed a ticket while dismissal/flush awaited.
    // Committing chapter navigation invalidates that old chapter work too.
    ++navigationRef.current;
    pendingViewport.current = null;
    pendingScroll.current = null;
    viewportRef.current = null;
    lastTextScrollRef.current = 0;
    anchorRef.current = 0;
    chapterIdRef.current = next;
    snapshotRef.current = null;
    setSnapshot(null);
    setMetadataEditing(false);
    setChapterId(next);
  }, [editorApi]);

  const refreshBook = useCallback(async (next: BookView) => {
    setBook(next);
    onBookChange?.(next);
    if (!next.entries.some(entry => entry.id === chapterIdRef.current)) {
      ++navigationRef.current;
      pendingViewport.current = null;
      pendingScroll.current = null;
      viewportRef.current = null;
      lastTextScrollRef.current = 0;
      const nextId = firstOpenEntryId(next);
      chapterIdRef.current = nextId;
      snapshotRef.current = null;
      setSnapshot(null);
      setChapterId(nextId);
      setMetadataEditing(false);
    } else if (chapterIdRef.current !== null) {
      applySnapshot(await window.desk.openChapter(next.bookId, chapterIdRef.current));
    }
  }, [applySnapshot, onBookChange]);

  // --- оформление ------------------------------------------------------------

  // Схема темы — маркерам (светлый/тёмный набор Pocket-палитры); реактивность
  // обеспечивают подписки useMarkerTheme/subscribeScheme (markers.ts). Резолв
  // темы происходит в App, живая смена системной схемы доезжает через проп.
  useEffect(() => {
    setActiveScheme(appearanceTheme.scheme);
  }, [appearanceTheme]);

  // --- Zen и порядок Escape ---------------------------------------------------

  const overlayRef = useRef({ sidebarOverlay, popup, flyout, cardId, appearanceOpen, menuOpen, searchOpen, zen, editorApi, modalOpen: chapterAction !== null || renameOpen, platform });
  overlayRef.current = { sidebarOverlay, popup, flyout, cardId, appearanceOpen, menuOpen, searchOpen, zen, editorApi, modalOpen: chapterAction !== null || renameOpen, platform };

  /**
   * Единственный toggle Zen -- вызывается кнопкой, пунктом меню и
   * shortcut'ом. Вход воспроизводит прежнее поведение enterZen (гасит слои
   * без якоря, popup остаётся), выход просто снимает флаг: снимок и черновик
   * (Metadata/ReviewEditor) не размонтируются переключением Zen, поэтому
   * dirty-состояние формы переживает toggle в любую сторону.
   */
  const toggleZen = useCallback((): void => {
    if (overlayRef.current.zen) {
      setZen(false);
      return;
    }
    setFlyout(null);
    setCardId(null);
    setAppearanceOpen(false);
    setMenuOpen(false);
    setSearchOpen(false);
    setSidebarOverlay(null);
    setZen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        document.querySelector<HTMLInputElement>('.book__search-input')?.focus();
        return;
      }
      const overlay = overlayRef.current;
      // Ctrl/Cmd+Alt+Z переключает Zen независимо от Escape (см. ниже) --
      // платформа ещё не пришла -- shortcut просто не срабатывает, ложных
      // толкований по умолчанию (ctrl/meta === false) это не даёт. Открытый
      // модальный <dialog> (управление книгой) гасит toggle: он уже владеет
      // модальным фокусом, скрытый переход в Zen за ним не нужен.
      if (overlay.platform !== null && isZenShortcut(event, overlay.platform)) {
        event.preventDefault();
        if (!overlay.modalOpen) toggleZen();
        return;
      }
      if (event.key !== 'Escape') return;
      // Активный разделитель владеет Escape: его capture-listener отменяет
      // preview и не даёт этому же нажатию закрыть другой слой.
      if (document.documentElement.classList.contains('is-resizing-sidebar')) return;
      // Порядок: только всплывающие слои (попап обрабатывает и свой
      // onKeyDown — двойное закрытие идемпотентно). Zen сюда не входит:
      // Escape никогда не переключает Zen, только верхние слои.
      if (overlay.sidebarOverlay !== null) {
        setSidebarOverlay(null);
        (overlay.sidebarOverlay === 'chapters' ? chaptersButtonRef : reviewButtonRef).current?.focus();
        return;
      }
      if (overlay.popup !== null) {
        setPopup(null);
        return;
      }
      if (overlay.flyout !== null) {
        setFlyout(null);
        return;
      }
      if (overlay.cardId !== null) {
        setCardId(null);
        return;
      }
      if (overlay.menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (overlay.appearanceOpen) {
        setAppearanceOpen(false);
        return;
      }
      if (overlay.searchOpen) {
        // The focused search field clears its query before collapsing.
        if ((event.target as HTMLElement)?.closest('.book__search')) return;
        setSearchOpen(false);
        return;
      }
      if (overlay.editorApi?.dismissPreview()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };
    // Capture-фаза: Galley может перехватывать Escape/shortcut в
    // bubbling-фазе, а гарантированный порядок обязан работать при любом фокусе.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [toggleZen]);

  // --- поиск -------------------------------------------------------------------

  /**
   * Переход к находке: механика зависит от вида (выделение + прокрутка).
   * Поиск никогда не забирает фокус из своего поля -- в «Тексте» это
   * отдельная от EditorSelection декорация (revealRange с `focus: false`,
   * см. renderer/editor/search-highlight.ts), а в DOM-видах -- то же
   * window.getSelection, но помеченное searchHighlightActiveRef, чтобы
   * снятие подсветки не задело настоящее выделение пользователя.
   */
  const revealSearchResult = useCallback(
    (range: SearchRange): void => {
      if (snapshot === null) return;
      if (mode === 'text') {
        editorApi?.revealRange(range.from, range.to, { focus: false });
        return;
      }
      if (mode === 'source') {
        if (sourceRef.current === null) return;
        revealTextOffset(sourceRef.current, range.from, range.to);
        searchHighlightActiveRef.current = true;
        return;
      }
      // Сравнение: производные координаты → display через явные координаты
      // сегментов (правки показаны парами before/after, введённая часть сдвинута).
      if (comparisonRef.current === null) return;
      const display = derivedRangeToDisplayRange(comparisonSegments(snapshot), range.from, range.to);
      if (display !== null) {
        revealTextOffset(comparisonRef.current, display.from, display.to);
        searchHighlightActiveRef.current = true;
      }
    },
    [mode, snapshot, editorApi],
  );

  /** Снимает поисковую подсветку: пустой запрос, нет совпадений, смена главы/панели. */
  const clearSearchHighlight = useCallback((): void => {
    if (mode === 'text') {
      editorApi?.clearSearchHighlight();
      return;
    }
    if (searchHighlightActiveRef.current) {
      window.getSelection()?.removeAllRanges();
      searchHighlightActiveRef.current = false;
    }
  }, [mode, editorApi]);

  useEffect(() => {
    chapterIdRef.current = chapterId;
    if (chapterId === null) {
      snapshotRef.current = null;
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setError(null);
    window.desk
      .openChapter(book.bookId, chapterId)
      .then((loaded) => {
        if (!cancelled) applySnapshot(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [book.bookId, chapterId, applySnapshot]);

  useEffect(() => {
    if (chapterId !== null) {
      positionCache.set(book.bookId, { chapterId, scrollTop: lastTextScrollRef.current, anchor: viewportRef.current?.derivedOffset ?? anchorRef.current, viewport: viewportRef.current ?? undefined });
    }
    // Подписка заменяется при смене главы и снимает только свой обработчик.
    return window.desk.onSnapshot((incoming) => {
      if (incoming.bookId === book.bookId && incoming.chapterId === chapterId) {
        applySnapshot(incoming);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.bookId, chapterId, applySnapshot]);

  // Запись исчезла (применена/удалена/стала конфликтной) — попап закрывается.
  useEffect(() => {
    if (popup?.kind === 'record' && snapshot !== null && !snapshot.records.some((record) => record.id === popup.id)) {
      setPopup(null);
    }
    if (cardId !== null && snapshot !== null && !snapshot.records.some((record) => record.id === cardId)) {
      setCardId(null);
    }
  }, [popup, cardId, snapshot]);

  // The ticket belongs to one navigation. Cleanup cancels late layout work,
  // including the legacy pixel-only restore for profiles without an anchor.
  useEffect(() => {
    if (snapshot === null) return;
    let frame = 0;
    let cancelled = false;
    let attempts = 0;
    const navigation = navigationRef.current;
    const tick = (): void => {
      if (cancelled || navigation !== navigationRef.current || chapterId !== chapterIdRef.current) return;
      const pending = pendingViewport.current;
      if (pending !== null) {
        if (pending.bookId !== book.bookId || pending.chapterId !== chapterId || pending.mode !== mode || pending.navigation !== navigation) return;
        const restored = mode === 'text' ? editorApi?.restoreViewport(pending.anchor) === true
          : mode === 'comparison' && comparisonRef.current !== null && restoreComparisonViewport(comparisonRef.current, comparisonSegments(snapshot), pending.anchor);
        if (restored) {
          viewportRef.current = pending.anchor;
          pendingViewport.current = null;
          pendingScroll.current = null;
          return;
        }
      } else if (mode === 'text' && pendingScroll.current !== null) {
        const scroller = textRef.current?.querySelector<HTMLElement>('.cm-scroller');
        if (scroller) {
          scroller.scrollTop = pendingScroll.current;
          if (Math.abs(scroller.scrollTop - pendingScroll.current) < 1) { pendingScroll.current = null; return; }
        }
      } else return;
      if (++attempts < 120) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [snapshot, mode, editorApi, chapterId, book.bookId]);

  captureViewportRef.current = () => {
    if (mode === 'text') return editorApi?.captureViewport() ?? null;
    if (mode === 'comparison' && comparisonRef.current !== null && snapshotRef.current !== null) {
      return captureComparisonViewport(comparisonRef.current, comparisonSegments(snapshotRef.current));
    }
    return null;
  };

  const savePosition = useCallback(async (): Promise<void> => {
    if (chapterId === null || chapterId !== chapterIdRef.current) return;
    const viewport = matchingViewport(pendingViewport.current, book.bookId, chapterId, modeRef.current, navigationRef.current) ?? captureViewportRef.current() ?? viewportRef.current;
    viewportRef.current = viewport;
    const scroller = textRef.current?.querySelector<HTMLElement>('.cm-scroller');
    if (scroller !== undefined && scroller !== null) lastTextScrollRef.current = scroller.scrollTop;
    const anchor = viewport?.derivedOffset ?? anchorRef.current;
    positionCache.set(book.bookId, { chapterId, scrollTop: lastTextScrollRef.current, anchor, viewport: viewport ?? undefined });
    // IPC persists integer CSS pixels; zoomed Chromium scrollers may be fractional.
    await window.desk.savePosition(book.bookId, chapterId, anchor, Math.round(lastTextScrollRef.current));
  }, [book.bookId, chapterId]);

  const schedulePositionSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void savePosition().catch(() => undefined); }, SAVE_DEBOUNCE_MS);
  }, [savePosition]);

  useEffect(() => () => {
    ++navigationRef.current;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
  }, []);

  const rememberScroll = useCallback((scrollTop: number) => {
    lastTextScrollRef.current = scrollTop;
    schedulePositionSave();
  }, [schedulePositionSave]);

  const rememberAnchor = useCallback((anchor: number) => {
    anchorRef.current = anchor;
    schedulePositionSave();
  }, [schedulePositionSave]);

  // Транспорт команд: expectedRevision — из последнего подтверждения этой
  // главы, ошибка сохранения показывается без оптимистичного «Сохранено».
  const handleCommand = useCallback(
    async (command: Command): Promise<Snapshot> => {
      if (chapterId === null) throw new Error('Глава не открыта');
      const expected = revisionsRef.current.get(chapterId) ?? 0;
      try {
        const next = await window.desk.command(book.bookId, chapterId, expected, command);
        applySnapshot(next);
        setSaveError(null);
        return next;
      } catch (cause) {
        if (command.type === 'metadata') {
          // Validation/stale-form rejection did not write. Ask main for the
          // actual session state; only a failed persistence blocks closing.
          const current = await window.desk.openChapter(book.bookId, chapterId).catch(() => null);
          if (current !== null && current.saveState === 'saved') {
            applySnapshot(current);
            throw cause;
          }
        }
        // Отказ ввода при показанном внешнем изменении — не сбой сохранения:
        // на main сессия в состоянии external отвергает любой ввод как
        // устаревший (STALE_REVISION), поэтому чип остаётся аффордансом
        // «Внешнее изменение» с кнопками разрешения, а не уводит пользователя
        // к «Перечитать главу». Настоящие сбои (SAVE_FAILED и прочие) при
        // любом другом состоянии показываются как «Ошибка сохранения».
        // Код ошибки через contextBridge не переносится (у Error сохраняется
        // только message), поэтому признак — состояние снимка.
        if (snapshotRef.current?.saveState !== 'external') {
          setSaveError(errorText(cause));
        }
        throw cause;
      }
    },
    [book.bookId, chapterId, applySnapshot],
  );

  /** Команда с проглатыванием ошибки: состояние уже показано пользователю. */
  const submit = useCallback(
    (command: Command): Promise<Snapshot | null> =>
      handleCommand(command).then(
        () => null as Snapshot | null,
        () => null,
      ),
    [handleCommand],
  );

  /**
   * Маршрут команд записи: в «Тексте» команды идут через FIFO редактора
   * (порядок с вводом сохраняется), в остальных видах — напрямую в main.
   */
  const dispatchCommand = useCallback(
    (command: Command): void => {
      if (mode === 'text' && editorApi !== null) editorApi.enqueue(command);
      else void submit(command);
    },
    [mode, editorApi, submit],
  );

  /** Заметка главы идёт напрямую: ошибка сохранения возвращается в попап. */
  const noteCommand = useCallback(
    (text: string): Promise<void> => handleCommand({ type: 'note', text }).then(() => undefined),
    [handleCommand],
  );

  const resolveExternal = useCallback(
    async (choice: 'open-external' | 'export-local') => {
      if (chapterId === null) return;
      setError(null);
      try {
        applySnapshot(await window.desk.resolveExternal(book.bookId, chapterId, choice));
        // Явное разрешение внешнего изменения — единственный (кроме
        // «Перечитать главу») путь принять внешнюю базу в редакторе.
        setSaveError(null);
        setEditorEpoch((epoch) => epoch + 1);
      } catch (cause) {
        setSaveError(errorText(cause));
      }
    },
    [book.bookId, chapterId, applySnapshot],
  );

  const rereadChapter = useCallback(() => {
    if (chapterId === null) return;
    setError(null);
    window.desk
      .openChapter(book.bookId, chapterId)
      .then((loaded) => {
        applySnapshot(loaded);
        setSaveError(null);
        setEditorEpoch((epoch) => epoch + 1);
      })
      .catch((cause: unknown) => setError(errorText(cause)));
  }, [book.bookId, chapterId, applySnapshot]);

  useEffect(() => window.desk.onCloseRequest(async (closing) => {
    const element = document.querySelector<HTMLElement>('.book');
    if (!closing) {
      if (element) element.inert = false;
      return;
    }
    if (closing) {
      try {
        if ((await metadataRef.current?.requestDismiss()) === false) throw new Error('Закрытие отменено: метаданные не завершены');
        if (element) element.inert = true;
        await editorApi?.flushPending();
        if (saveError !== null) throw new Error(saveError);
        await savePosition().catch(() => undefined);
        ++navigationRef.current;
      } catch (cause) {
        if (element) element.inert = false;
        setError(errorText(cause));
        throw cause;
      }
    }
  }), [editorApi, saveError, savePosition]);

  const closeBook = async (): Promise<void> => {
    if ((await metadataRef.current?.requestDismiss()) === false) return;
    try {
      await savePosition().catch(() => undefined);
      await window.desk.closeBook(book.bookId);
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    onClose();
  };

  /** Смена вида закрывает всплывающие слои: flyout не бывает вне «Текста». */
  const switchMode = useCallback(async (next: ViewMode): Promise<void> => {
    const navigation = ++navigationRef.current;
    const chapter = chapterIdRef.current;
    const current = modeRef.current;
    const anchor = captureViewportRef.current() ?? viewportRef.current;
    // Snapshot text can lag optimistic typing. Rebase from the exact document
    // whose geometry supplied the anchor, never from a stale acknowledged text.
    const capturedText = current === 'text' ? editorApi?.getText() ?? null : snapshotRef.current?.text ?? null;
    pendingViewport.current = null;
    pendingScroll.current = null;
    if (current === 'text') lastTextScrollRef.current = textRef.current?.querySelector<HTMLElement>('.cm-scroller')?.scrollTop ?? lastTextScrollRef.current;
    try {
      await editorApi?.flushPending();
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    if (navigation !== navigationRef.current || chapter !== chapterIdRef.current) return;
    if (next === current) return;
    if (anchor !== null && chapter !== null && current !== 'source' && next !== 'source') {
      const settledText = snapshotRef.current?.text ?? '';
      const rebased = capturedText === null ? anchor : rebaseViewport(anchor, capturedText, settledText);
      const clamped = { ...rebased, derivedOffset: Math.min(rebased.derivedOffset, settledText.length) };
      viewportRef.current = clamped;
      pendingViewport.current = { bookId: book.bookId, chapterId: chapter, mode: next, anchor: clamped, navigation };
    }
    setMode(next);
    setFlyout(null);
    setPopup(null);
    setCardId(null);
  }, [editorApi, book.bookId]);

  const handleSelectionWindow = useCallback(
    (range: { from: number; to: number; x: number; y: number; bottom: number } | null) => {
      setFlyout(range);
    },
    [],
  );

  const openRecordAt = useCallback((recordId: string, rect: AnchorRect) => {
    setFlyout(null);
    setCardId(null);
    setPopup({ kind: 'record', id: recordId, at: rect });
  }, []);

  const openDraft = useCallback(
    (signalType: SignalTypeName) => {
      if (flyout === null) return;
      setPopup({ kind: 'draft', from: flyout.from, to: flyout.to, signalType, at: flyout });
      setFlyout(null);
    },
    [flyout],
  );

  /** Выбор записи в панели: скролл только при известном якоре; иначе карточка. */
  const selectRecord = useCallback(
    (record: RecordView) => {
      setPopup(null);
      setCardId(null);
      const anchored = record.from !== null && record.to !== null;
      if (anchored && mode === 'text' && editorApi !== null && editorApi.reveal(record.id)) {
        // Программный переход к записи не оставляет flyout: reveal выделяет
        // диапазон (selection window успевает сработать) — гасим его здесь.
        setFlyout(null);
        const coords = editorApi.coordsAt(record.to as number);
        setPopup({ kind: 'record', id: record.id, at: coords === null ? null : { x: coords.left, y: coords.top, bottom: coords.bottom } });
        return;
      }
      if (anchored && mode === 'comparison' && comparisonRef.current !== null) {
        const marker = comparisonRef.current.querySelector<HTMLElement>(`[data-record-id="${cssEscape(record.id)}"]`);
        if (marker !== null) {
          const rect = marker.getBoundingClientRect();
          setPopup({ kind: 'record', id: record.id, at: { x: rect.left, y: rect.top, bottom: rect.bottom } });
          return;
        }
      }
      // Нет якоря (или вид не даёт перейти) — карточка прямо в панели.
      setCardId(record.id);
    },
    [mode, editorApi],
  );

  const entries = book.entries.map(entry => ({ ...entry, title: titles[entry.id] ?? entry.title }));
  const activeChapter = entries.find((entry) => entry.id === chapterId) ?? null;
  // Локальный флаг ошибки сильнее снимка: main не уведомляет о сбое записи.
  const readOnly = snapshot === null || snapshot.readOnlyReason !== null;
  const saveState = saveError !== null ? 'error' : snapshot?.saveState ?? null;
  const popupRecord =
    popup?.kind === 'record' ? snapshot?.records.find((record) => record.id === popup.id) ?? null : null;
  // Переменные темы, шрифт и подложка живут на контейнере App (.app-root);
  // здесь остаётся только ширина колонки чтения из настройки.
  const widthStyle: CSSProperties = contentWidthStyle(appearance.lineWidth);
  // Подсказка кнопок Zen показывает shortcut отдельной строкой (Task 10);
  // до прихода platform (см. эффект windowState выше) -- вариант Linux/Windows.
  const zenShortcut = zenShortcutLabel(platform);
  const preferredLayout = layoutPreview ?? layout;
  const fittedLayout = useMemo(() => fitLayout(preferredLayout, availableWidth), [preferredLayout, availableWidth]);
  useEffect(() => {
    if (sidebarOverlay === null) return;
    const stillResponsive = sidebarOverlay === 'chapters' ? fittedLayout.chaptersCollapsed : fittedLayout.reviewCollapsed;
    if (stillResponsive) return;
    const side = sidebarOverlay;
    setSidebarOverlay(null);
    requestAnimationFrame(() => (side === 'chapters' ? chaptersButtonRef : reviewButtonRef).current?.focus());
  }, [fittedLayout, sidebarOverlay]);
  const chaptersCollapsed = zen || chaptersHidden || fittedLayout.chaptersCollapsed;
  const reviewCollapsed = zen || reviewHidden || fittedLayout.reviewCollapsed;
  const bodyStyle = {
    '--chapters-width': `${fittedLayout.chaptersWidth}px`,
    '--review-width': `${fittedLayout.reviewWidth}px`,
  } as CSSProperties;
  const constrainWidth = (side: 'chapters' | 'review', value: number): number => {
    const otherVisible = side === 'chapters' ? !reviewCollapsed : !chaptersCollapsed;
    const otherWidth = otherVisible
      ? side === 'chapters' ? fittedLayout.reviewWidth : fittedLayout.chaptersWidth
      : 0;
    const visibleDividers = Number(!chaptersCollapsed) + Number(!reviewCollapsed);
    const available = availableWidth - CENTER_MIN_WIDTH - RESIZER_WIDTH * visibleDividers - otherWidth;
    return Math.max(SIDEBAR_BOUNDS.min, Math.min(SIDEBAR_BOUNDS.max, value, available));
  };
  const previewWidth = (side: 'chapters' | 'review', value: number): void => {
    const nextValue = constrainWidth(side, value);
    setLayoutPreview(current => ({ ...(current ?? layout), [side === 'chapters' ? 'chaptersWidth' : 'reviewWidth']: nextValue }));
  };
  const commitWidth = (side: 'chapters' | 'review', value: number): void => {
    const nextValue = constrainWidth(side, value);
    const next = { ...(layoutPreview ?? layout), [side === 'chapters' ? 'chaptersWidth' : 'reviewWidth']: nextValue };
    setLayoutPreview(null);
    onLayoutChange(next);
  };
  const toggleSidebar = (side: 'chapters' | 'review'): void => {
    const responsiveCollapsed = side === 'chapters' ? fittedLayout.chaptersCollapsed : fittedLayout.reviewCollapsed;
    if (responsiveCollapsed) {
      setSidebarOverlay(current => current === side ? null : side);
      return;
    }
    if (side === 'chapters') setChaptersHidden(hidden => !hidden);
    else setReviewHidden(hidden => !hidden);
  };

  return (
    <div className={zen ? 'book book--zen' : 'book'}>
      <TitleBar title={book.title}>
        <div className="book__toolbar" aria-label="Действия книги">
          {saveState !== null && (
            <Tooltip content={snapshot?.readOnlyReason ? 'Только чтение' : SAVE_STATE_LABELS[saveState]}>
              <span role="status" className={`book__save-state book__save-state--${snapshot?.readOnlyReason ? 'readonly' : saveState}`}>{snapshot?.readOnlyReason ? 'Только чтение' : SAVE_STATE_LABELS[saveState]}</span>
            </Tooltip>
          )}
          <Tooltip content="Поиск по главе" shortcut="Ctrl+F">
            <button type="button" ref={searchButtonRef} aria-label="Поиск по главе" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}><IconSearch /></button>
          </Tooltip>
          <Tooltip content="Оглавление">
            <button ref={chaptersButtonRef} type="button" aria-label="Оглавление" aria-pressed={!chaptersCollapsed || sidebarOverlay === 'chapters'} onClick={() => toggleSidebar('chapters')}><IconLayoutSidebar /></button>
          </Tooltip>
          <Tooltip content="Рецензия">
            <button ref={reviewButtonRef} type="button" aria-label="Рецензия" aria-pressed={!reviewCollapsed || sidebarOverlay === 'review'} onClick={() => toggleSidebar('review')}><IconLayoutSidebarRight /></button>
          </Tooltip>
          <div className="book__view-toggle" aria-label="Режим просмотра">
            <Tooltip content="Текст"><button type="button" aria-label="Текст" aria-pressed={mode === 'text'} onClick={() => switchMode('text')}><IconFileText /></button></Tooltip>
            <Tooltip content="Сравнение"><button type="button" aria-label="Сравнение" aria-pressed={mode === 'comparison'} onClick={() => switchMode('comparison')}><IconColumns2 /></button></Tooltip>
            <Tooltip content="Исходник"><button type="button" aria-label="Исходник" aria-pressed={mode === 'source'} onClick={() => switchMode('source')}><IconCode /></button></Tooltip>
          </div>
          {zen ? (
            <Tooltip content="Выйти из Zen" shortcut={zenShortcut}>
              <button type="button" className="book__zen-exit" aria-label="Выйти из Zen" onClick={toggleZen}><IconTargetOff /><span>Выйти из Zen</span></button>
            </Tooltip>
          ) : (
            <Tooltip content="Режим Zen" shortcut={zenShortcut}>
              <button type="button" className="book__zen-direct" aria-label="Режим Zen" onClick={toggleZen}><IconTarget /></button>
            </Tooltip>
          )}
          <div className="book__menu" ref={menuRef}>
            <Tooltip content="Меню книги">
              <button type="button" ref={menuButtonRef} aria-label="Меню книги" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><IconDots /></button>
            </Tooltip>
            {menuOpen && <div className="book__menu-items" aria-label="Действия книги" onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setMenuOpen(false); }}>
              <button type="button" disabled={metadataEditing} onClick={() => { actionTriggerRef.current = document.activeElement as HTMLElement; setRenameOpen(true); setMenuOpen(false); }}><IconPencil />Переименовать книгу</button>
              <button type="button" onClick={() => { setAppearanceOpen((open) => !open); setMenuOpen(false); }}><IconAdjustments />Оформление</button>
              <button type="button" className="book__menu-diagnostics" onClick={() => {
                window.dispatchEvent(new CustomEvent('galley-desk:open-diagnostics', {
                  detail: { returnFocus: () => menuButtonRef.current?.focus() },
                }));
                setMenuOpen(false);
              }}><IconInfoCircle />Диагностика</button>
              <button type="button" className="book__menu-zen" onClick={() => { toggleZen(); setMenuOpen(false); }}><IconTarget />Режим Zen</button>
              <button type="button" className="book__close" onClick={() => void closeBook()}><IconBookOff />Закрыть книгу</button>
            </div>}
            {appearanceOpen && (
              <div className="book__appearance-panel">
                <button className="book__appearance-close" type="button" aria-label="Закрыть оформление" onClick={() => setAppearanceOpen(false)}><IconX /></button>
                <Appearance value={appearance} onChange={onAppearanceChange} />
                {appearanceError !== null && <p className="app__error" role="alert">{appearanceError}</p>}
              </div>
            )}
          </div>
        </div>
      </TitleBar>
      {saveError !== null && (
        <p className="app__error book__save-error" role="alert">
          {saveError} <button type="button" className="book__reread" onClick={rereadChapter}>Перечитать главу</button>
        </p>
      )}
      {snapshot?.readOnlyReason && <p className="app__error" role="alert">{snapshot.readOnlyReason}</p>}
      {snapshot !== null && snapshot.saveState === 'external' && (
        <div className="book__external-actions" role="alert">
          {snapshot.recoveryConflict && <span>Восстановление приостановлено. Локальная пара сохранена в журнале. Открытие внешней версии сохранит резервную копию; экспорт сохранит копию главы в новую папку и откроет внешнюю версию.</span>}
          <button type="button" onClick={() => void resolveExternal('open-external')}>Открыть внешнюю версию</button>
          <button type="button" onClick={() => void resolveExternal('export-local')}>{snapshot.recoveryConflict ? 'Экспортировать копию главы…' : 'Экспортировать черновик…'}</button>
        </div>
      )}
      {renameOpen && <RenameBookDialog title={book.title}
        onChange={async change => { await editorApi?.flushPending(); await refreshBook(await window.desk.manageBook(book.bookId, change)); }}
        onClose={() => { setRenameOpen(false); menuButtonRef.current?.focus(); }} />}
      {chapterAction && <ChapterDialogs action={chapterAction} book={book}
        onChange={async change => { await editorApi?.flushPending(); await refreshBook(await window.desk.manageBook(book.bookId, change)); }}
        onRefresh={refreshBook}
        onClose={() => { setChapterAction(null); requestAnimationFrame(() => actionTriggerRef.current?.isConnected ? actionTriggerRef.current.focus() : document.querySelector<HTMLButtonElement>('.book__chapter-row--active .book__chapter-menu-button, .book__chapter-menu-button, .book__chapter-tools button')?.focus()); }} />}
      {openWarning !== null && !openWarningDismissed && (
        <p className="app__error" role="alert">
          {openWarning}
          <button type="button" onClick={() => setOpenWarningDismissed(true)}>Скрыть</button>
        </p>
      )}
      {error !== null && (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}
      {layoutError !== null && (
        <p className="app__error book__layout-error" role="alert">
          {layoutError} <button type="button" onClick={onLayoutRetry}>Повторить сохранение ширины</button>
        </p>
      )}
      <div
        ref={bodyRef}
        className={`book__body${chaptersCollapsed ? ' book__body--chapters-collapsed' : ''}${reviewCollapsed ? ' book__body--review-collapsed' : ''}`}
        style={bodyStyle}
      >
        {!chaptersCollapsed && (
          <ChapterSidebar book={{ ...book, entries }} activeId={chapterId} disabled={metadataEditing || chapterAction !== null || renameOpen}
            onOpen={id => void switchChapter(id)}
            onAction={action => {
              actionTriggerRef.current = 'chapterId' in action
                ? Array.from(document.querySelectorAll<HTMLButtonElement>('[data-chapter-menu-id]')).find(button => button.dataset.chapterMenuId === action.chapterId) ?? null
                : document.activeElement as HTMLElement;
              setChapterAction(action);
            }} />
        )}
        {!chaptersCollapsed && <SidebarResizer side="chapters" value={fittedLayout.chaptersWidth} onPreview={value => previewWidth('chapters', value)} onCommit={value => commitWidth('chapters', value)} onCancel={() => setLayoutPreview(null)} />}
        <section className="book__content">
          {activeChapter !== null && <div className="book__chapter-heading">
            <div className="book__chapter-label"><h2 className="book__chapter-title">{activeChapter.title || activeChapter.path}</h2><small>{activeChapter.path.split('/').pop()}</small></div>
            {snapshot !== null && <MetadataPopover ref={metadataRef} key={chapterId} source={snapshot.sourceText} readOnly={readOnly || saveError!==null || snapshot.saveState!=='saved'} onEditing={setMetadataEditing} onSave={async(yaml,sourceText)=>{
              await editorApi?.flushPending();
              await handleCommand({type:'metadata',yaml,sourceText});
              setEditorEpoch(epoch=>epoch+1);
            }}/>}</div>}
          {snapshot !== null && searchOpen && (
            // Поиск по главе: область подписана и зависит от вида (Текст/
            // Сравнение — snapshot.text, Исходник — snapshot.sourceText).
            <ChapterSearch
              onClose={() => { setSearchOpen(false); searchButtonRef.current?.focus(); }}
              area={mode}
              chapterId={snapshot.chapterId}
              searchText={mode === 'source' ? snapshot.sourceText : snapshot.text}
              onReveal={revealSearchResult}
              onClearHighlight={clearSearchHighlight}
            />
          )}
          {mode === 'source' ? (
            // Read-only исходник: отдельное presentation view, ввод недоступен, без маркеров.
            <pre
              className="book__source"
              ref={sourceRef}
              style={widthStyle}
              onMouseDown={() => { searchHighlightActiveRef.current = false; }}
            >
              {snapshot?.sourceText ?? ''}
            </pre>
          ) : mode === 'comparison' ? (
            <>
              {/* Применение имеет отдельный стек: кнопки контекста §6 только в «Сравнении». */}
              <div style={{ display: 'flex', gap: '0.5rem' }} aria-label="История применения">
                <button
                  type="button"
                  disabled={readOnly || snapshot === null || !snapshot.canUndoApply}
                  onClick={() => void submit({ type: 'undo-apply' })}
                >
                  Отменить применение
                </button>
                <button
                  type="button"
                  disabled={readOnly || snapshot === null || !snapshot.canRedoApply}
                  onClick={() => void submit({ type: 'redo-apply' })}
                >
                  Повторить применение
                </button>
              </div>
              <div
                className="book__comparison"
                ref={comparisonRef}
                onScroll={schedulePositionSave}
                style={widthStyle}
                onMouseDown={() => { searchHighlightActiveRef.current = false; }}
              >
                {snapshot !== null && <ComparisonView snapshot={snapshot} onRecordClick={(record, rect) => openRecordAt(record.id, rect)} />}
              </div>
            </>
          ) : (
            <div className="book__text" ref={textRef} style={widthStyle}>
              {snapshot?.recoveryConflict ? <pre aria-label="Локальная версия восстановления">{snapshot.text}</pre> : snapshot !== null && (
                <ReviewEditor
                  previewBlocked={popup !== null || cardId !== null}
                  key={`${chapterId}:${editorEpoch}`}
                  snapshot={metadataEditing ? {...snapshot,readOnlyReason:'Изменение метаданных'} : snapshot}
                  theme={appearanceTheme.scheme}
                  onCommand={handleCommand}
                  onSelectionChange={rememberAnchor}
                  onScrollChange={rememberScroll}
                  initialAnchor={anchorRef.current}
                  onSelectionWindow={handleSelectionWindow}
                  onRecordClick={openRecordAt}
                  flyoutFocusRef={flyoutFocusRef as MutableRefObject<(() => void) | null>}
                  onApi={setEditorApi}
                />
              )}
            </div>
          )}
        </section>
        {!reviewCollapsed && <SidebarResizer side="review" value={fittedLayout.reviewWidth} onPreview={value => previewWidth('review', value)} onCommit={value => commitWidth('review', value)} onCancel={() => setLayoutPreview(null)} />}
        {!reviewCollapsed && (
          <aside
            className="book__review"
            aria-label="Рецензия"
          >
            <h2 className="book__panel-title">Рецензия</h2>
            {/* Ключ по главе: заметка, черновик и попап принадлежат главе —
                смена главы не переносит черновик в другую главу. */}
            <ChapterNote readOnly={readOnly} key={chapterId ?? 'none'} value={snapshot?.chapterNote ?? ''} onCommand={noteCommand} />
            <ReviewList
              readOnly={readOnly}
              records={snapshot?.records ?? []}
              cardRecordId={cardId}
              onSelect={selectRecord}
              onCommand={dispatchCommand}
              onCardClose={() => setCardId(null)}
            />
          </aside>
        )}
        {!zen && sidebarOverlay !== null && (
          <div ref={overlayPanelRef} className={`book__sidebar-overlay book__sidebar-overlay--${sidebarOverlay}`} role="dialog" aria-label={sidebarOverlay === 'chapters' ? 'Оглавление' : 'Рецензия'}>
            <button type="button" className="book__sidebar-overlay-close" aria-label="Закрыть панель" onClick={() => {
              const side = sidebarOverlay;
              setSidebarOverlay(null);
              (side === 'chapters' ? chaptersButtonRef : reviewButtonRef).current?.focus();
            }}><IconX /></button>
            {sidebarOverlay === 'chapters' ? (
              <ChapterSidebar book={{ ...book, entries }} activeId={chapterId} disabled={metadataEditing || chapterAction !== null || renameOpen}
                onOpen={id => { setSidebarOverlay(null); void switchChapter(id); }}
                onAction={action => { setSidebarOverlay(null); actionTriggerRef.current = document.activeElement as HTMLElement; setChapterAction(action); }} />
            ) : (
              <aside className="book__review" aria-label="Рецензия">
                <h2 className="book__panel-title">Рецензия</h2>
                <ChapterNote readOnly={readOnly} key={chapterId ?? 'none'} value={snapshot?.chapterNote ?? ''} onCommand={noteCommand} />
                <ReviewList readOnly={readOnly} records={snapshot?.records ?? []} cardRecordId={cardId} onSelect={selectRecord} onCommand={dispatchCommand} onCardClose={() => setCardId(null)} />
              </aside>
            )}
          </div>
        )}
      </div>
      {!readOnly && mode === 'text' && flyout !== null && (
        <SignalFlyout x={flyout.x} bottom={flyout.bottom} onPick={openDraft} registerFocus={registerFlyoutFocus} />
      )}
      {!readOnly && popup?.kind === 'draft' && (
        <RecordPopup
          draft={{ from: popup.from, to: popup.to, signalType: popup.signalType }}
          at={popup.at}
          onCommand={dispatchCommand}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.kind === 'record' && popupRecord !== null && (
        <RecordPopup readOnly={readOnly} record={popupRecord} at={popup.at} onCommand={dispatchCommand} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
