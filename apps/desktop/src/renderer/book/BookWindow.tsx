import { BookManagement } from './BookManagement';
import { Metadata } from './Metadata';
import { IconSearch, IconFileText, IconColumns2, IconCode, IconTarget, IconTargetOff, IconDots, IconAdjustments, IconBookOff, IconBook, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import type { AppearanceSettings, BookView, Command, RecordView, Snapshot } from '../../shared/api';
import type { ThemeDefinition } from '@inkyquill/galley-themes';
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

type Props = {
  book: BookView;
  /** Сохранённая позиция из записи недавних (восстановление после перезапуска). */
  restore?: ReadingRestore | null;
  onClose: () => void;
  /** Настройки оформления: источник — App (один тематический контейнер). */
  appearance: AppearanceSettings;
  /** Резолв темы в App («Системная» уже развёрнута по схеме ОС). */
  appearanceTheme: ThemeDefinition;
  /** Ошибка применения настроек (сбой загрузки/отказ main) — панель показывает. */
  appearanceError: string | null;
  /** Изменение из панели: App применяет на контейнере и сохраняет в appData. */
  onAppearanceChange: (next: AppearanceSettings) => void;
};

/** Позиция чтения для восстановления при открытии книги. */
export type ReadingRestore = { chapterId: string; scrollTop: number; anchor?: number | null };

// Восстановление главы и прокрутки при повторном открытии книги в этом окне;
// между запусками позицию сохраняет основной процесс (desk.savePosition).
const positionCache = new Map<string, { chapterId: string; scrollTop: number; anchor: number }>();

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
  if (start === null || end === null) return;
  const range = document.createRange();
  range.setStart(start.text, Math.max(0, Math.min(start.offset, start.text.data.length)));
  range.setEnd(end.text, Math.max(0, Math.min(end.offset, end.text.data.length)));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  start.text.parentElement?.scrollIntoView({ block: 'center' });
}

function firstOpenEntryId(book: BookView): string | null {
  const open = book.entries.find((entry) => !entry.missing);
  return open?.id ?? book.entries[0]?.id ?? null;
}

/** Прямоугольник маркера/курсора в viewport-координатах (попап позиционируется fixed). */
type AnchorRect = { x: number; y: number; bottom: number };

type ViewMode = 'text' | 'comparison' | 'source';

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
 * скрыты, постоянная кнопка выхода; Escape сначала закрывает popup) и
 * настройки оформления (панель в окне; тема/шрифт живут на контейнере App,
 * в книгах не пишут).
 */
export function BookWindow({
  book: initialBook,
  restore = null,
  onClose,
  appearance,
  appearanceTheme,
  appearanceError,
  onAppearanceChange,
}: Props) {
  const [book, setBook] = useState(initialBook);
  const [managementOpen, setManagementOpen] = useState(false);
  const cached = positionCache.get(book.bookId);
  // Сохранённая позиция из записи недавних сильнее внутрисессионного кэша;
  // глава могла исчезнуть из манифеста — тогда восстановление игнорируется.
  const validRestore =
    restore !== null && book.entries.some((entry) => entry.id === restore.chapterId) ? restore : null;
  const [chapterId, setChapterId] = useState<string | null>(
    validRestore?.chapterId ?? cached?.chapterId ?? firstOpenEntryId(book),
  );
  // Актуальная глава вне React-потока: поздние ack и снимки сравниваются с
  // ней, а не с устаревшим замыканием (гон смены главы, см. applySnapshot).
  const chapterIdRef = useRef<string | null>(chapterId);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [metadataEditing, setMetadataEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // Зеркало показанного снимка для решений вне React-потока (чип сбоя
  // сохранения при внешнем изменении — см. handleCommand).
  const snapshotRef = useRef<Snapshot | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('text');
  // Эпоха редактора: явная команда «Перечитать» пересоздаёт редактор из
  // сняка сессии (принудительная ресинхронизация после сбоя сохранения).
  const [editorEpoch, setEditorEpoch] = useState(0);
  const textRef = useRef<HTMLDivElement | null>(null);
  const comparisonRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLPreElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<number>(validRestore?.anchor ?? cached?.anchor ?? 0);
  const pendingScroll = useRef<number | null>(validRestore?.scrollTop ?? cached?.scrollTop ?? null);
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
  // Zen: панели и topbar скрыты; выход — постоянная кнопка или Escape
  // (сначала закрываются popup/flyout/карточка, затем сам Zen).
  const [zen, setZen] = useState(false);
  // Фильтр оглавления по названиям глав: только отображение, манифест не меняется.
  const [chapterFilter, setChapterFilter] = useState('');
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
    try {
      await editorApi?.flushPending();
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    chapterIdRef.current = next;
    snapshotRef.current = null;
    setSnapshot(null);
    setMetadataEditing(false);
    setChapterId(next);
  }, [editorApi]);

  const refreshBook = useCallback(async (next: BookView) => {
    setBook(next);
    if (!next.entries.some(entry => entry.id === chapterIdRef.current)) {
      const nextId = firstOpenEntryId(next);
      chapterIdRef.current = nextId;
      snapshotRef.current = null;
      setSnapshot(null);
      setChapterId(nextId);
      setMetadataEditing(false);
    } else if (chapterIdRef.current !== null) {
      applySnapshot(await window.desk.openChapter(next.bookId, chapterIdRef.current));
    }
  }, [applySnapshot]);

  // --- оформление ------------------------------------------------------------

  // Схема темы — маркерам (светлый/тёмный набор Pocket-палитры); реактивность
  // обеспечивают подписки useMarkerTheme/subscribeScheme (markers.ts). Резолв
  // темы происходит в App, живая смена системной схемы доезжает через проп.
  useEffect(() => {
    setActiveScheme(appearanceTheme.scheme);
  }, [appearanceTheme]);

  // --- Zen и порядок Escape ---------------------------------------------------

  const overlayRef = useRef({ popup, flyout, cardId, appearanceOpen, menuOpen, searchOpen, zen, editorApi });
  overlayRef.current = { popup, flyout, cardId, appearanceOpen, menuOpen, searchOpen, zen, editorApi };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        document.querySelector<HTMLInputElement>('.book__search-input')?.focus();
        return;
      }
      if (event.key !== 'Escape') return;
      const overlay = overlayRef.current;
      // Порядок: сначала всплывающие слои (попап обрабатывает и свой
      // onKeyDown — двойное закрытие идемпотентно), затем сам Zen.
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
      if (overlay.zen) setZen(false);
    };
    // Capture-фаза: Galley может перехватывать Escape в bubbling-фазе,
    // а гарантированный порядок «popup → Zen» обязан работать при любом фокусе.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // --- поиск -------------------------------------------------------------------

  /** Переход к находке: механика зависит от вида (выделение + прокрутка). */
  const revealSearchResult = useCallback(
    (range: SearchRange): void => {
      if (snapshot === null) return;
      if (mode === 'text') {
        editorApi?.revealRange(range.from, range.to);
        return;
      }
      if (mode === 'source') {
        if (sourceRef.current !== null) revealTextOffset(sourceRef.current, range.from, range.to);
        return;
      }
      // Сравнение: производные координаты → display через явные координаты
      // сегментов (правки показаны парами before/after, введённая часть сдвинута).
      if (comparisonRef.current === null) return;
      const display = derivedRangeToDisplayRange(comparisonSegments(snapshot), range.from, range.to);
      if (display !== null) revealTextOffset(comparisonRef.current, display.from, display.to);
    },
    [mode, snapshot, editorApi],
  );

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
      positionCache.set(book.bookId, { chapterId, scrollTop: cached?.scrollTop ?? 0, anchor: anchorRef.current });
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

  // Восстановление прокрутки после появления текста: скроллер находится
  // внутри редактора (CM виртуализирует строки и сам ведёт прокрутку).
  // CM дорисовывает и измеряет контент асинхронно, поэтому попытка
  // повторяется кадр за кадром, пока прокрутка не будет принята.
  const restoreScrollRef = useRef<(target: number) => void>(() => undefined);
  restoreScrollRef.current = (target: number): void => {
    let attempts = 0;
    const tick = (): void => {
      const scroller = textRef.current?.querySelector<HTMLElement>('.cm-scroller') ?? null;
      if (scroller === null) {
        if (++attempts < 120) requestAnimationFrame(tick);
        return;
      }
      scroller.scrollTop = target;
      if (Math.abs(scroller.scrollTop - target) < 1) {
        pendingScroll.current = null;
        return;
      }
      if (++attempts < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (snapshot !== null && pendingScroll.current !== null) {
      restoreScrollRef.current(pendingScroll.current);
    }
  }, [snapshot]);

  const scrollerOf = useCallback((): HTMLElement | null => {
    return textRef.current?.querySelector<HTMLElement>('.cm-scroller') ?? null;
  }, []);

  /** Дебаiced сохранение позиции: прокрутка и/или якорь выделения. */
  const schedulePositionSave = useCallback(() => {
    if (chapterId === null) return;
    positionCache.set(book.bookId, {
      chapterId,
      scrollTop: scrollerOf()?.scrollTop ?? 0,
      anchor: anchorRef.current,
    });
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void window.desk
        .savePosition(book.bookId, chapterId, anchorRef.current, scrollerOf()?.scrollTop ?? 0)
        .catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  }, [book.bookId, chapterId, scrollerOf]);

  const rememberScroll = useCallback(
    (scrollTop: number) => {
      void scrollTop;
      schedulePositionSave();
    },
    [schedulePositionSave],
  );

  const rememberAnchor = useCallback(
    (anchor: number) => {
      anchorRef.current = anchor;
      schedulePositionSave();
    },
    [schedulePositionSave],
  );

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
    if (element) element.inert = closing;
    if (closing) {
      try {
        await editorApi?.flushPending();
        if (saveError !== null) throw new Error(saveError);
      } catch (cause) {
        setError(errorText(cause));
        throw cause;
      }
    }
  }), [editorApi, saveError]);

  const closeBook = async (): Promise<void> => {
    try {
      await window.desk.closeBook(book.bookId);
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    onClose();
  };

  /** Смена вида закрывает всплывающие слои: flyout не бывает вне «Текста». */
  const switchMode = useCallback(async (next: ViewMode): Promise<void> => {
    try {
      await editorApi?.flushPending();
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    setMode(next);
    setFlyout(null);
    setPopup(null);
    setCardId(null);
  }, [editorApi]);

  /** Вход в Zen: панели рецензии скрыты, слои без якоря гасятся (попап живёт). */
  const enterZen = useCallback((): void => {
    setFlyout(null);
    setCardId(null);
    setAppearanceOpen(false);
    setMenuOpen(false);
    setSearchOpen(false);
    setZen(true);
  }, []);

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
  // Фильтр оглавления: сравнение по названию без изменения manifest.
  const normalizedFilter = chapterFilter.trim().toLowerCase();
  const visibleEntries =
    normalizedFilter === ''
      ? entries
      : entries.filter((entry) =>
          (entry.title !== '' ? entry.title : entry.path).toLowerCase().includes(normalizedFilter),
        );
  // Переменные темы, шрифт и подложка живут на контейнере App (.app-root);
  // здесь остаётся только ширина колонки чтения из настройки.
  const widthStyle: CSSProperties = contentWidthStyle(appearance.lineWidth);

  return (
    <div className={zen ? 'book book--zen' : 'book'}>
      {!zen && (
        <header className="book__header">
          <h1 className="book__title">{book.title}</h1>
          {saveState !== null && (
            <span role="status" title={snapshot?.readOnlyReason ? 'Только чтение' : SAVE_STATE_LABELS[saveState]} className={`book__save-state book__save-state--${snapshot?.readOnlyReason ? 'readonly' : saveState}`}>{snapshot?.readOnlyReason ? 'Только чтение' : SAVE_STATE_LABELS[saveState]}</span>
          )}
          {saveError !== null && (
            <button type="button" className="book__reread" onClick={rereadChapter}>
              Перечитать главу
            </button>
          )}
          {snapshot?.readOnlyReason && <p role="alert">{snapshot.readOnlyReason}</p>}
          {snapshot !== null && snapshot.saveState === 'external' && (
            <span className="book__external-actions">
              {snapshot.recoveryConflict && <span>Восстановление приостановлено. Локальная пара сохранена в журнале. Открытие внешней версии сохранит резервную копию; экспорт сохранит копию главы в новую папку и откроет внешнюю версию.</span>}
              <button type="button" onClick={() => void resolveExternal('open-external')}>
                Открыть внешнюю версию
              </button>
              <button type="button" onClick={() => void resolveExternal('export-local')}>
                {snapshot.recoveryConflict ? 'Экспортировать копию главы…' : 'Экспортировать черновик…'}
              </button>
            </span>
          )}
          <button type="button" ref={searchButtonRef} title="Поиск по главе (Ctrl+F)" aria-label="Поиск по главе" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}><IconSearch /></button>
          <div className="book__view-toggle" aria-label="Режим просмотра">
            <button type="button" title="Текст" aria-label="Текст" aria-pressed={mode === 'text'} onClick={() => switchMode('text')}><IconFileText /></button>
            <button type="button" title="Сравнение" aria-label="Сравнение" aria-pressed={mode === 'comparison'} onClick={() => switchMode('comparison')}><IconColumns2 /></button>
            <button type="button" title="Исходник" aria-label="Исходник" aria-pressed={mode === 'source'} onClick={() => switchMode('source')}><IconCode /></button>
          </div>
          <button type="button" title="Режим Zen" aria-label="Режим Zen" onClick={enterZen}><IconTarget /></button>
          <div className="book__menu" ref={menuRef}>
            <button type="button" ref={menuButtonRef} title="Меню книги" aria-label="Меню книги" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><IconDots /></button>
            {menuOpen && <div className="book__menu-items" aria-label="Действия книги" onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setMenuOpen(false); }}>
              <button type="button" disabled={metadataEditing} onClick={() => { setManagementOpen(true); setMenuOpen(false); }}><IconBook />Управление книгой</button>
              <button type="button" onClick={() => { setAppearanceOpen((open) => !open); setMenuOpen(false); }}><IconAdjustments />Оформление</button>
              <button type="button" className="book__close" onClick={() => void closeBook()}><IconBookOff />Закрыть книгу</button>
            </div>}
          </div>
        </header>
      )}
      {managementOpen && <BookManagement book={book} chapterId={chapterId}
        onChange={async change => { await editorApi?.flushPending(); await refreshBook(await window.desk.manageBook(book.bookId, change)); }}
        onRefresh={refreshBook} onClose={() => { setManagementOpen(false); menuButtonRef.current?.focus(); }} />}
      {appearanceOpen && (
        <div className="book__appearance-panel">
          <button className="book__appearance-close" type="button" aria-label="Закрыть оформление" onClick={() => setAppearanceOpen(false)}><IconX /></button>
          <Appearance value={appearance} onChange={onAppearanceChange} />
          {appearanceError !== null && (
            <p className="app__error" role="alert">
              {appearanceError}
            </p>
          )}
        </div>
      )}
      {zen && (
        // Постоянная доступная кнопка выхода: топбар скрыт, управление Zen
        // остаётся на экране всегда (плюс Escape — после закрытия popup).
        <button
          type="button"
          className="book__zen-exit"
          onClick={() => setZen(false)}
          title="Выйти из Zen (Esc)"
        >
          <IconTargetOff /><span>Выйти из Zen</span>
        </button>
      )}
      {error !== null && (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}
      <div
        className="book__body"
      >
        {!zen && (
          <nav className="book__chapters" aria-label="Оглавление">
            <h2 className="book__panel-title">Оглавление</h2>
            <input
              type="text"
              className="book__chapter-filter"
              aria-label="Фильтр глав"
              placeholder="Фильтр глав…"
              value={chapterFilter}
              onChange={(event) => setChapterFilter(event.target.value)}
            />
            {/* Фильтр меняет только отображение списка; манифест не перезаписывается. */}
            {visibleEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === chapterId ? 'book__chapter book__chapter--active' : 'book__chapter'}
                disabled={entry.missing}
                title={entry.missing ? 'Файл главы отсутствует' : entry.path}
                onClick={() => switchChapter(entry.id)}
              >
                <span className="book__chapter-name">{entry.title !== '' ? entry.title : entry.path}</span>
                <small>{entry.path.split('/').pop()}{entry.missing ? ' (файл отсутствует)' : ''}</small>
              </button>
            ))}
            {visibleEntries.length === 0 && <p className="book__chapters-empty">Главы не найдены</p>}
          </nav>
        )}
        <section className="book__content">
          {activeChapter !== null && <h2 className="book__chapter-title">{activeChapter.title || activeChapter.path}</h2>}
          {snapshot !== null && <Metadata key={chapterId} source={snapshot.sourceText} readOnly={readOnly || saveError!==null || snapshot.saveState!=='saved'} onEditing={setMetadataEditing} onSave={async(yaml,sourceText)=>{
            await editorApi?.flushPending();
            await handleCommand({type:'metadata',yaml,sourceText});
            setEditorEpoch(epoch=>epoch+1);
          }}/>}
          {snapshot !== null && searchOpen && (
            // Поиск по главе: область подписана и зависит от вида (Текст/
            // Сравнение — snapshot.text, Исходник — snapshot.sourceText).
            <ChapterSearch
              onClose={() => { setSearchOpen(false); searchButtonRef.current?.focus(); }}
              area={mode}
              searchText={mode === 'source' ? snapshot.sourceText : snapshot.text}
              onReveal={revealSearchResult}
            />
          )}
          {mode === 'source' ? (
            // Read-only исходник: отдельное presentation view, ввод недоступен, без маркеров.
            <pre className="book__source" ref={sourceRef} style={widthStyle}>
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
              <div className="book__comparison" ref={comparisonRef} style={widthStyle}>
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
                  initialAnchor={validRestore?.anchor ?? cached?.anchor ?? null}
                  onSelectionWindow={handleSelectionWindow}
                  onRecordClick={openRecordAt}
                  flyoutFocusRef={flyoutFocusRef as MutableRefObject<(() => void) | null>}
                  onApi={setEditorApi}
                />
              )}
            </div>
          )}
        </section>
        {!zen && (
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
