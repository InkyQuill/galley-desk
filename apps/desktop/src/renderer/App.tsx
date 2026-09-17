import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppearanceSettings, BookView, DeskApi, Recent } from '../shared/api';
import type { ThemeDefinition } from '@inkyquill/galley-themes';
import {
  DEFAULT_APPEARANCE,
  resolveThemeForScheme,
  subscribeSystemScheme,
  systemSchemeDark,
  windowContainerStyle,
} from './appearance/Appearance';
import { BookWindow } from './book/BookWindow';
import type { ReadingRestore } from './book/BookWindow';
import { RecentBooks } from './book/RecentBooks';
import { TitleBar } from './TitleBar';
import { TooltipHost } from './ui/Tooltip';

declare global {
  interface Window {
    desk: DeskApi;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Операция не выполнена';
}

// Контекст приложения: экран недавних книг либо рабочее окно открытой книги.
// Кэш позиций чтения живёт в BookWindow на уровне модуля (восстановление
// внутри живого окна), а запись недавних несёт сохранённую позицию —
// она восстанавливает главу и прокрутку даже после перезапуска приложения.
//
// Оформление живёт на уровне App: один тематический контейнер красит оба
// экрана (раньше контейнер был только внутри BookWindow, и первый экран
// оставался несветлённым), BookWindow получает настройки через пропсы.
export function App() {
  const [book, setBook] = useState<BookView | null>(null);
  const [restore, setRestore] = useState<ReadingRestore | null>(null);
  // Предупреждение открытия (например, recent() не ответил после выбора
  // папки диалогом) — книга всё равно открыта, восстановления не будет.
  const [openWarning, setOpenWarning] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Настройки оформления из appData; пока они не загружены, App не рисует
  // содержимое — нейтральную подложку первого кадра даёт body (app.css).
  const [appearance, setAppearance] = useState<AppearanceSettings | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  // Системная схема в состоянии + подписка matchMedia: «Системная» тема
  // следует за живой сменой схемы ОС, а не только при случайном ререндере.
  const [systemDark, setSystemDark] = useState(systemSchemeDark);

  useEffect(() => {
    let cancelled = false;
    window.desk
      .appearance()
      .then((value) => {
        if (!cancelled) setAppearance(value);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Сбой загрузки не оставляет приложение на пустом экране: значения
        // по умолчанию, причина — в панели «Оформление» окна книги.
        setAppearance({ ...DEFAULT_APPEARANCE });
        setAppearanceError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribeSystemScheme(setSystemDark), []);

  const appearanceTheme = useMemo<ThemeDefinition | null>(
    () => (appearance !== null ? resolveThemeForScheme(appearance.themeId, systemDark) : null),
    [appearance, systemDark],
  );

  /** Пользовательское изменение: применяется локально и сохраняется в appData. */
  const updateAppearance = useCallback((next: AppearanceSettings): void => {
    setAppearance(next);
    setAppearanceError(null);
    void window.desk.setAppearance(next).catch((cause: unknown) => {
      // main отверг значение (границы/неизвестная тема) — состояние показано.
      setAppearanceError(errorText(cause));
    });
  }, []);

  const openBook = useCallback((view: BookView, recent?: Recent, warning?: string) => {
    setRestore(
      recent?.lastChapterId
        ? {
            chapterId: recent.lastChapterId,
            scrollTop: recent.lastScrollTop ?? 0,
            // Якорь выделения восстанавливается редактором (контракт Recent).
            anchor: recent.lastAnchor ?? null,
          }
        : null,
    );
    setOpenWarning(warning ?? null);
    setBook(view);
  }, []);
  const closeBook = useCallback(() => {
    setBook(null);
    setRestore(null);
    setOpenWarning(null);
    setRefreshKey((key) => key + 1);
  }, []);

  if (appearance === null || appearanceTheme === null) {
    return <div className="app-root" />;
  }

  return (
    <div
      className="app-root"
      style={windowContainerStyle(appearanceTheme, appearance)}
      data-scheme={appearanceTheme.scheme}
    >
      <TitleBar title={book?.title ?? 'Galley Desk'} />
      <div className={`app-root__content${book === null ? ' app-root__content--welcome' : ''}`}>
        {book === null ? (
          <RecentBooks onOpen={openBook} refreshKey={refreshKey} />
        ) : (
          <BookWindow
          book={book}
          restore={restore}
          openWarning={openWarning}
          onClose={closeBook}
          onBookChange={setBook}
          appearance={appearance}
          appearanceTheme={appearanceTheme}
          appearanceError={appearanceError}
          onAppearanceChange={updateAppearance}
          />
        )}
      </div>
      {/* Единственный themed host всех подсказок (Task 10) -- внутри .app-root,
          чтобы наследовать переменные темы и UI-шрифта, а не отдельный портал. */}
      <TooltipHost />
    </div>
  );
}
