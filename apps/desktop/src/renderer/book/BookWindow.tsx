import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { BookView, Command, RecordView, Snapshot } from '../../shared/api';
import { ComparisonView } from '../editor/ComparisonView';
import type { ReviewEditorApi } from '../editor/ReviewEditor';
import { ReviewEditor } from '../editor/ReviewEditor';
import type { SignalTypeName } from '../editor/markers';
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
 */
export function BookWindow({ book, restore = null, onClose }: Props) {
  const cached = positionCache.get(book.bookId);
  // Сохранённая позиция из записи недавних сильнее внутрисессионного кэша;
  // глава могла исчезнуть из манифеста — тогда восстановление игнорируется.
  const validRestore =
    restore !== null && book.entries.some((entry) => entry.id === restore.chapterId) ? restore : null;
  const [chapterId, setChapterId] = useState<string | null>(
    validRestore?.chapterId ?? cached?.chapterId ?? firstOpenEntryId(book),
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('text');
  // Эпоха редактора: явная команда «Перечитать» пересоздаёт редактор из
  // сняка сессии (принудительная ресинхронизация после сбоя сохранения).
  const [editorEpoch, setEditorEpoch] = useState(0);
  const textRef = useRef<HTMLDivElement | null>(null);
  const comparisonRef = useRef<HTMLDivElement | null>(null);
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
  // Функция фокуса flyout для Tab-пути из редактора (регистрирует SignalFlyout).
  const flyoutFocusRef = useRef<(() => void) | null>(null);
  const registerFlyoutFocus = useCallback((focus: (() => void) | null) => {
    flyoutFocusRef.current = focus;
  }, []);

  const applySnapshot = useCallback((next: Snapshot) => {
    revisionsRef.current.set(next.chapterId, next.revision);
    // Локальный флаг ошибки сохранения снимается только явным действием
    // (успешная команда, «Перечитать главу», resolveExternal) — приход
    // снимка само по себе не прячет сбой и не принимает внешнюю версию.
    setSnapshot(next);
  }, []);

  useEffect(() => {
    if (chapterId === null) {
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
        setSaveError(errorText(cause));
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
  const switchMode = useCallback((next: ViewMode): void => {
    setMode(next);
    setFlyout(null);
    setPopup(null);
    setCardId(null);
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

  const activeChapter = book.entries.find((entry) => entry.id === chapterId) ?? null;
  // Локальный флаг ошибки сильнее снимка: main не уведомляет о сбое записи.
  const saveState = saveError !== null ? 'error' : snapshot?.saveState ?? null;
  const popupRecord =
    popup?.kind === 'record' ? snapshot?.records.find((record) => record.id === popup.id) ?? null : null;

  return (
    <div className="book">
      <header className="book__header">
        <h1 className="book__title">{book.title}</h1>
        {saveState !== null && (
          <span className={`book__save-state book__save-state--${saveState}`}>{SAVE_STATE_LABELS[saveState]}</span>
        )}
        {saveError !== null && (
          <button type="button" className="book__reread" onClick={rereadChapter}>
            Перечитать главу
          </button>
        )}
        {snapshot !== null && snapshot.saveState === 'external' && (
          <span className="book__external-actions">
            <button type="button" onClick={() => void resolveExternal('open-external')}>
              Открыть внешнюю версию
            </button>
            <button type="button" onClick={() => void resolveExternal('export-local')}>
              Экспортировать черновик…
            </button>
          </span>
        )}
        <button type="button" className="book__close" onClick={() => void closeBook()}>
          Закрыть книгу
        </button>
      </header>
      {error !== null && (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}
      <div className="book__body" style={{ gridTemplateColumns: '16rem 1fr 18rem' }}>
        <nav className="book__chapters" aria-label="Оглавление">
          {book.entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === chapterId ? 'book__chapter book__chapter--active' : 'book__chapter'}
              disabled={entry.missing}
              title={entry.missing ? 'Файл главы отсутствует' : entry.path}
              onClick={() => setChapterId(entry.id)}
            >
              {entry.title !== '' ? entry.title : entry.path}
              {entry.missing ? ' (файл отсутствует)' : ''}
            </button>
          ))}
        </nav>
        <section className="book__content">
          {activeChapter !== null && <h2 className="book__chapter-title">{activeChapter.title || activeChapter.path}</h2>}
          <div className="book__view-toggle" aria-label="Режим просмотра">
            <button
              type="button"
              aria-pressed={mode === 'text'}
              className={mode === 'text' ? 'book__view book__view--active' : 'book__view'}
              onClick={() => switchMode('text')}
            >
              Текст
            </button>
            <button
              type="button"
              aria-pressed={mode === 'comparison'}
              className={mode === 'comparison' ? 'book__view book__view--active' : 'book__view'}
              onClick={() => switchMode('comparison')}
            >
              Сравнение
            </button>
            <button
              type="button"
              aria-pressed={mode === 'source'}
              className={mode === 'source' ? 'book__view book__view--active' : 'book__view'}
              onClick={() => switchMode('source')}
            >
              Исходник
            </button>
          </div>
          {mode === 'source' ? (
            // Read-only исходник: отдельное presentation view, ввод недоступен, без маркеров.
            <pre className="book__source">{snapshot?.sourceText ?? ''}</pre>
          ) : mode === 'comparison' ? (
            <>
              {/* Применение имеет отдельный стек: кнопки контекста §6 только в «Сравнении». */}
              <div style={{ display: 'flex', gap: '0.5rem' }} aria-label="История применения">
                <button
                  type="button"
                  disabled={snapshot === null || !snapshot.canUndoApply}
                  onClick={() => void submit({ type: 'undo-apply' })}
                >
                  Отменить применение
                </button>
                <button
                  type="button"
                  disabled={snapshot === null || !snapshot.canRedoApply}
                  onClick={() => void submit({ type: 'redo-apply' })}
                >
                  Повторить применение
                </button>
              </div>
              <div className="book__comparison" ref={comparisonRef}>
                {snapshot !== null && <ComparisonView snapshot={snapshot} onRecordClick={(record, rect) => openRecordAt(record.id, rect)} />}
              </div>
            </>
          ) : (
            <div className="book__text" ref={textRef}>
              {snapshot !== null && (
                <ReviewEditor
                  key={`${chapterId}:${editorEpoch}`}
                  snapshot={snapshot}
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
        <aside
          className="book__review"
          aria-label="Рецензия"
          style={{
            borderLeft: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
            padding: '0.75rem',
            overflowY: 'auto',
            display: 'grid',
            gap: '0.75rem',
            alignContent: 'start',
          }}
        >
          {/* Ключ по главе: заметка, черновик и попап принадлежат главе —
              смена главы не переносит черновик в другую главу. */}
          <ChapterNote key={chapterId ?? 'none'} value={snapshot?.chapterNote ?? ''} onCommand={noteCommand} />
          <ReviewList
            records={snapshot?.records ?? []}
            cardRecordId={cardId}
            onSelect={selectRecord}
            onCommand={dispatchCommand}
            onCardClose={() => setCardId(null)}
          />
        </aside>
      </div>
      {mode === 'text' && flyout !== null && (
        <SignalFlyout x={flyout.x} bottom={flyout.bottom} onPick={openDraft} registerFocus={registerFlyoutFocus} />
      )}
      {popup?.kind === 'draft' && (
        <RecordPopup
          draft={{ from: popup.from, to: popup.to, signalType: popup.signalType }}
          at={popup.at}
          onCommand={dispatchCommand}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.kind === 'record' && popupRecord !== null && (
        <RecordPopup record={popupRecord} at={popup.at} onCommand={dispatchCommand} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
