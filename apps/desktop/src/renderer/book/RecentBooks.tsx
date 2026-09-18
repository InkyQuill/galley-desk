import { useCallback, useEffect, useState } from 'react';
import type { BookView, Recent } from '../../shared/api';

type Props = {
  /** warning — предупреждение об открытии (например, не удалось перечитать
   * недавние после выбора папки диалогом); окно книги показывает его. */
  onOpen: (book: BookView, recent?: Recent, warning?: string) => void;
  /** Меняется после закрытия книги — список перечитывается. */
  refreshKey: number;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Операция не выполнена';
}

/** Экран последних книг: открыть папку, повторно открыть или забыть книгу. */
export function RecentBooks({ onOpen, refreshKey }: Props) {
  const [recents, setRecents] = useState<Recent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRecents(await window.desk.recent());
    } catch (cause) {
      setError(`Не удалось загрузить список последних книг: ${errorText(cause)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const chooseBook = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const book = await window.desk.chooseBook();
      if (book === null) return;
      // main уже открыл книгу и обновил запись недавних с сохранённой
      // позицией (upsert в openFolder); сопоставление строго по bookId —
      // не по title и не по первой записи списка, папка могла переехать.
      try {
        const latest = await window.desk.recent();
        const recent = latest.find((entry) => entry.bookId === book.bookId);
        onOpen(book, recent);
      } catch (cause) {
        // Книга уже открыта на стороне main: не оставляем скрытую сессию —
        // передаём её дальше без восстановления и предупреждаем в окне книги.
        onOpen(book, undefined, `Не удалось восстановить позицию чтения: ${errorText(cause)}`);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const openRecent = async (path: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Запись недавних едет вместе с книгой: она несёт последнюю главу
      // и прокрутку для восстановления после перезапуска.
      const recent = recents.find((entry) => entry.path === path);
      onOpen(await window.desk.openRecent(path), recent);
    } catch (cause) {
      setError(errorText(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const forgetRecent = async (path: string): Promise<void> => {
    setError(null);
    try {
      // Удаляется только запись списка; файлы книги остаются на месте.
      await window.desk.forgetRecent(path);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <main className="app">
      <h1>Galley Desk</h1>
      <p className="app__hint">Откройте папку книги или выберите из недавних.</p>
      <button type="button" className="app__primary" disabled={busy} onClick={() => void chooseBook()}>
        Открыть папку…
      </button>
      {error !== null && <p className="app__error" role="alert">{error}</p>}
      {recents.length > 0 && (
        <ul className="recent-list">
          {recents.map((recent) => (
            <li key={recent.path} className="recent-list__item">
              <div className="recent-list__info">
                <span className="recent-list__title">{recent.title}</span>
                <span className="recent-list__path">{recent.path}</span>
                {recent.missing && <span className="recent-list__missing">папка не найдена</span>}
              </div>
              <div className="recent-list__actions">
                <button type="button" disabled={busy} onClick={() => void openRecent(recent.path)}>
                  Открыть
                </button>
                <button type="button" disabled={busy} onClick={() => void forgetRecent(recent.path)}>
                  Забыть
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
