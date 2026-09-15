import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookView, Snapshot } from '../../shared/api';

type Props = {
  book: BookView;
  onClose: () => void;
};

/** Позиция чтения одной книги на время жизни окна. */
type ReadingPosition = { chapterId: string; scrollTop: number };

// Восстановление главы и прокрутки при повторном открытии книги в этом окне;
// между запусками позицию сохраняет основной процесс (desk.savePosition).
const positionCache = new Map<string, ReadingPosition>();

const SAVE_DEBOUNCE_MS = 200;
// Изображение в текущем виде — только локальный относительный путь: схемы,
// абсолютные пути и обход каталогов не превращаются в bookres-ссылки.
const IMAGE_PATTERN = /!\[[^\]]*\]\(([^()\s]+)\)/g;
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function isLocalImagePath(target: string): boolean {
  if (target.length === 0) return false;
  if (SCHEME_PATTERN.test(target)) return false;
  if (target.startsWith('/') || target.startsWith('\\') || target.includes('\\')) return false;
  if (target.startsWith('//')) return false;
  if (target.includes('?') || target.includes('#')) return false;
  const segments = target.split('/');
  if (segments.includes('..') || segments.includes('')) return false;
  return true;
}

function localImageTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(IMAGE_PATTERN)) {
    const target = match[1];
    if (target !== undefined && isLocalImagePath(target) && !targets.includes(target)) {
      targets.push(target);
    }
  }
  return targets;
}

function bookResourceUrl(bookId: string, target: string): string {
  const encoded = target.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${'bookres:'}//${bookId}/${encoded}`;
}

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
 * Рабочее окно книги: оглавление, текст главы и записи рецензии.
 * Редактор появится в следующей задаче — пока снимок показывается как текст.
 */
export function BookWindow({ book, onClose }: Props) {
  const cached = positionCache.get(book.bookId);
  const [chapterId, setChapterId] = useState<string | null>(cached?.chapterId ?? firstOpenEntryId(book));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLPreElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScroll = useRef<number | null>(cached?.scrollTop ?? null);

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
        if (!cancelled) setSnapshot(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [book.bookId, chapterId]);

  useEffect(() => {
    if (chapterId !== null) {
      positionCache.set(book.bookId, { chapterId, scrollTop: cached?.scrollTop ?? 0 });
    }
    // Подписка заменяется при смене главы и снимает только свой обработчик.
    return window.desk.onSnapshot((incoming) => {
      if (incoming.bookId === book.bookId && incoming.chapterId === chapterId) {
        setSnapshot(incoming);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.bookId, chapterId]);

  // Восстановление прокрутки после появления текста.
  useEffect(() => {
    if (snapshot !== null && pendingScroll.current !== null && textRef.current !== null) {
      textRef.current.scrollTop = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [snapshot]);

  const rememberScroll = useCallback(
    (scrollTop: number) => {
      if (chapterId === null) return;
      positionCache.set(book.bookId, { chapterId, scrollTop });
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void window.desk.savePosition(book.bookId, chapterId, 0, scrollTop).catch(() => undefined);
      }, SAVE_DEBOUNCE_MS);
    },
    [book.bookId, chapterId],
  );

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

  return (
    <div className="book">
      <header className="book__header">
        <h1 className="book__title">{book.title}</h1>
        {snapshot !== null && (
          <span className={`book__save-state book__save-state--${snapshot.saveState}`}>
            {SAVE_STATE_LABELS[snapshot.saveState]}
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
          <pre className="book__text" ref={textRef} onScroll={(event) => rememberScroll(event.currentTarget.scrollTop)}>
            {snapshot?.text ?? ''}
          </pre>
          {snapshot !== null && snapshot.records.length > 0 && (
            <ul className="book__records">
              {snapshot.records.map((record, index) => (
                <li key={record.id} className={`book__record book__record--${record.status}`}>
                  {recordLine(snapshot, index)}
                </li>
              ))}
            </ul>
          )}
          {snapshot !== null && localImageTargets(snapshot.text).length > 0 && (
            <div className="book__images">
              {localImageTargets(snapshot.text).map((target) => (
                <img
                  key={target}
                  className="book__image"
                  src={bookResourceUrl(book.bookId, target)}
                  alt={target}
                  title={target}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
