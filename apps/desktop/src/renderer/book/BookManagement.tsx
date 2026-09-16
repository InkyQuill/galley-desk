import { useEffect, useRef, useState } from 'react';
import { IconRefresh, IconX } from '@tabler/icons-react';
import type { BookChange, BookView } from '../../shared/api';

/** Explicit file management in the currently open directory only. */
export function BookManagement({
  book,
  chapterId,
  onChange,
  onRefresh,
  onClose,
}: {
  book: BookView;
  chapterId: string | null;
  onChange: (change: BookChange) => Promise<void>;
  onRefresh: (book: BookView) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(book.title);
  const [chapterTitle, setChapterTitle] = useState('');
  const [filename, setFilename] = useState('');
  const [files, setFiles] = useState<{ path: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [targetId, setTargetId] = useState(chapterId);
  const current =
    book.entries.find((entry) => entry.id === targetId) ??
    book.entries.find((entry) => entry.id === chapterId) ??
    book.entries[0];
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const refresh = async () => {
    const result = await window.desk.discoverChapters(book.bookId);
    setFiles(result.files);
    setSelected((previous) =>
      previous.filter((name) =>
        result.files.some((file) => file.path === name),
      ),
    );
    await refreshRef.current(result.book);
  };
  const message = (cause: unknown) =>
    cause instanceof Error ? cause.message : 'Операция не выполнена';
  useEffect(() => {
    dialog.current?.showModal();
    const load = () => {
      void refresh().catch((cause) => setError(message(cause)));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [book.bookId]);
  const run = async (change: BookChange) => {
    setBusy(true);
    setError(null);
    try {
      await onChange(change);
      setConfirmTrash(false);
      if (change.type === 'create') {
        setFilename('');
        setChapterTitle('');
      }
      await refresh();
    } catch (cause) {
      setError(message(cause));
      // A partial trash can leave a missing source; reconcile visible state.
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="book__management"
      aria-labelledby="book-management-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          if (confirmTrash) setConfirmTrash(false);
          else onClose();
        }
      }}
    >
      <header>
        <h2 id="book-management-title">Управление книгой</h2>
        <button
          type="button"
          disabled={busy}
          aria-label="Закрыть управление книгой"
          onClick={onClose}
        >
          <IconX />
        </button>
      </header>
      <p>Изменения относятся к открытой папке книги.</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || confirmTrash}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run({ type: 'rename', title });
          }}
        >
          <label>
            Название книги
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <button type="submit">Переименовать книгу</button>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run({ type: 'create', path: filename, title: chapterTitle });
          }}
        >
          <h3>Новая глава</h3>
          <label>
            Название новой главы
            <input
              value={chapterTitle}
              onChange={(event) => setChapterTitle(event.target.value)}
              required
            />
          </label>
          <label>
            Имя файла (.md)
            <input
              value={filename}
              placeholder="03-chapter.md"
              onChange={(event) => setFilename(event.target.value)}
              required
            />
          </label>
          <button type="submit">Создать главу</button>
        </form>
        <section aria-label="Файлы вне оглавления">
          <h3>Добавить файлы в оглавление</h3>
          <p>
            Только Markdown в этой папке. Исключённые файлы не показываются.
            Выбранные главы добавятся в конец.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void refresh().catch((cause) => setError(message(cause)));
            }}
          >
            <IconRefresh size={16} />
            Обновить список файлов
          </button>
          {files.length === 0 && <p>Новых файлов нет</p>}
          {files.map((file) => (
            <label className="book__management-file" key={file.path}>
              <input
                type="checkbox"
                checked={selected.includes(file.path)}
                onChange={(event) =>
                  setSelected((previous) =>
                    event.target.checked
                      ? [...previous, file.path]
                      : previous.filter((name) => name !== file.path),
                  )
                }
              />
              {file.path}
            </label>
          ))}
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => void run({ type: 'add', paths: selected })}
          >
            Добавить выбранные главы
          </button>
        </section>
        {book.entries.length > 0 && (
          <label>
            Глава для управления
            <select
              value={current?.id ?? ''}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {book.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title || entry.path} — {entry.path}
                  {entry.missing ? ' (файл отсутствует)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {current && (
          <section aria-label="Текущая глава">
            <h3>{current.title || current.path}</h3>
            <p>
              {current.path}
              {current.missing ? ' — файл отсутствует' : ''}
            </p>
            <p>
              Удаление из оглавления оставит Markdown и рецензию на диске. Файл
              можно добавить обратно.
            </p>
            <button
              type="button"
              onClick={() =>
                void run({ type: 'remove', chapterId: current.id })
              }
            >
              Убрать главу из книги
            </button>
            <button type="button" onClick={() => setConfirmTrash(true)}>
              Удалить файлы главы…
            </button>
          </section>
        )}
      </fieldset>
      {confirmTrash && current && (
        <section
          role="alertdialog"
          aria-labelledby="trash-title"
          aria-describedby="trash-description"
        >
          <h3 id="trash-title">Переместить главу в корзину?</h3>
          <p id="trash-description">
            Markdown «{current.path}» и связанный файл рецензии (правки, сигналы
            и заметка) будут перемещены в системную корзину. Глава исчезнет из
            оглавления. Файлы можно восстановить из корзины.
          </p>
          <button
            autoFocus
            type="button"
            disabled={busy}
            onClick={() => setConfirmTrash(false)}
          >
            Отмена удаления
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ type: 'trash', chapterId: current.id })}
          >
            Переместить в корзину
          </button>
        </section>
      )}
      {busy && <p role="status">Сохраняем изменения…</p>}
    </dialog>
  );
}
