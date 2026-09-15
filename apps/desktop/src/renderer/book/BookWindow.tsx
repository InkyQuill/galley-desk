import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookView, Command, Snapshot } from '../../shared/api';
import { ReviewEditor } from '../editor/ReviewEditor';

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

function recordLine(snapshot: Snapshot, index: number): string {
  const record = snapshot.records[index];
  if (record === undefined) return '';
  const where = record.from === null || record.to === null ? '' : ` (позиция ${record.from}–${record.to})`;
  const suffix = record.status === 'active' ? where : ` — ${record.status}${record.reason ? `: ${record.reason}` : ''}`;
  if (record.kind === 'edit') {
    return `Правка: ${record.before} → ${record.after}${suffix}`;
  }
  const type = record.signalType ?? '';
  const comment = record.comment.length > 0 ? `: ${record.comment}` : '';
  return `Сигнал [${type}]${comment}${suffix}`;
}

/**
 * Рабочее окно книги: оглавление, глава в редакторе Galley (режим «Текст»)
 * или read-only исходник («Источник»), записи рецензии. Редактор владеет
 * документом; окна снимка обновляют только записи и статус сохранения.
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
  const [mode, setMode] = useState<'text' | 'source'>('text');
  // Эпоха редактора: явная команда «Перечитать» пересоздаёт редактор из
  // сняка сессии (принудительная ресинхронизация после сбоя сохранения).
  const [editorEpoch, setEditorEpoch] = useState(0);
  const textRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<number>(validRestore?.anchor ?? cached?.anchor ?? 0);
  const pendingScroll = useRef<number | null>(validRestore?.scrollTop ?? cached?.scrollTop ?? null);
  // Ревизии последнего подтверждения по главам: expectedRevision берётся из
  // последнего ack, а не из устаревшего замыкания React.
  const revisionsRef = useRef(new Map<string, number>());

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

  const activeChapter = book.entries.find((entry) => entry.id === chapterId) ?? null;
  // Локальный флаг ошибки сильнее снимка: main не уведомляет о сбое записи.
  const saveState = saveError !== null ? 'error' : snapshot?.saveState ?? null;

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
      <div className="book__body">
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
          <div className="book__view-toggle" role="tablist" aria-label="Режим просмотра">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'text'}
              className={mode === 'text' ? 'book__view book__view--active' : 'book__view'}
              onClick={() => setMode('text')}
            >
              Текст
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'source'}
              className={mode === 'source' ? 'book__view book__view--active' : 'book__view'}
              onClick={() => setMode('source')}
            >
              Источник
            </button>
          </div>
          {mode === 'source' ? (
            // Read-only исходник: отдельное presentation view, ввод недоступен.
            <pre className="book__source">{snapshot?.sourceText ?? ''}</pre>
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
                />
              )}
            </div>
          )}
          {snapshot !== null && snapshot.records.length > 0 && (
            <ul className="book__records">
              {snapshot.records.map((record, index) => (
                <li key={record.id} className={`book__record book__record--${record.status}`}>
                  {recordLine(snapshot, index)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
