import { useCallback, useState } from 'react';
import type { BookView, DeskApi } from '../shared/api';
import { BookWindow } from './book/BookWindow';
import { RecentBooks } from './book/RecentBooks';

declare global {
  interface Window {
    desk: DeskApi;
  }
}

// Контекст приложения: экран недавних книг либо рабочее окно открытой книги.
// Кэш позиций чтения живёт в BookWindow на уровне модуля, поэтому повторное
// открытие той же книги восстанавливает главу и прокрутку.
export function App() {
  const [book, setBook] = useState<BookView | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openBook = useCallback((view: BookView) => setBook(view), []);
  const closeBook = useCallback(() => {
    setBook(null);
    setRefreshKey((key) => key + 1);
  }, []);

  return book === null ? (
    <RecentBooks onOpen={openBook} refreshKey={refreshKey} />
  ) : (
    <BookWindow book={book} onClose={closeBook} />
  );
}
