import { useCallback, useState } from 'react';
import type { BookView, DeskApi, Recent } from '../shared/api';
import { BookWindow } from './book/BookWindow';
import type { ReadingRestore } from './book/BookWindow';
import { RecentBooks } from './book/RecentBooks';

declare global {
  interface Window {
    desk: DeskApi;
  }
}

// Контекст приложения: экран недавних книг либо рабочее окно открытой книги.
// Кэш позиций чтения живёт в BookWindow на уровне модуля (восстановление
// внутри живого окна), а запись недавних несёт сохранённую позицию —
// она восстанавливает главу и прокрутку даже после перезапуска приложения.
export function App() {
  const [book, setBook] = useState<BookView | null>(null);
  const [restore, setRestore] = useState<ReadingRestore | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openBook = useCallback((view: BookView, recent?: Recent) => {
    setRestore(
      recent?.lastChapterId
        ? { chapterId: recent.lastChapterId, scrollTop: recent.lastScrollTop ?? 0 }
        : null,
    );
    setBook(view);
  }, []);
  const closeBook = useCallback(() => {
    setBook(null);
    setRestore(null);
    setRefreshKey((key) => key + 1);
  }, []);

  return book === null ? (
    <RecentBooks onOpen={openBook} refreshKey={refreshKey} />
  ) : (
    <BookWindow book={book} restore={restore} onClose={closeBook} />
  );
}
