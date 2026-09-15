import { useCallback, useEffect, useState } from 'react';
import type { BookView, Recent } from '../../shared/api';

type Props = {
  onOpen: (book: BookView) => void;
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
      if (book !== null) {
        onOpen(book);
        return;
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
      onOpen(await window.desk.openRecent(path));
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
