import { useCallback, useEffect, useRef, useState } from 'react';
import { IconRefresh, IconX } from '@tabler/icons-react';
import type { BookChange, BookView } from '../../shared/api';
import type { ChapterAction } from './ChapterSidebar';

export function ChapterDialogs({ action, book, onChange, onRefresh, onClose }: { action: ChapterAction; book: BookView; onChange: (change: BookChange) => Promise<void>; onRefresh: (book: BookView) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [filename, setFilename] = useState('');
  const [files, setFiles] = useState<{ path: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entry = 'chapterId' in action ? book.entries.find(candidate => candidate.id === action.chapterId) : undefined;
  const discover = useCallback(async () => {
    const result = await window.desk.discoverChapters(book.bookId);
    setFiles(result.files);
    setSelected(previous => previous.filter(path => result.files.some(file => file.path === path)));
    await onRefresh(result.book);
  }, [book.bookId, onRefresh]);
  useEffect(() => {
    dialog.current?.showModal();
    if (action.kind !== 'discover') return;
    const load = () => void discover().catch(cause => setError(cause instanceof Error ? cause.message : 'Операция не выполнена'));
    load(); window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [action.kind, discover]);
  const run = async (change: BookChange) => {
    setBusy(true); setError(null);
    try { await onChange(change); onClose(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Операция не выполнена');
      if (change.type === 'trash') await discover().catch(() => undefined);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (action.kind === 'remove' && entry) void run({ type: 'remove', chapterId: entry.id });
    // The action and target are immutable for this dialog instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const heading = action.kind === 'create' ? 'Новая глава' : action.kind === 'discover' ? 'Найти главы в папке' : action.kind === 'remove' ? 'Убрать главу из оглавления?' : 'Переместить главу в корзину?';
  return <dialog ref={dialog} className="book__action-dialog" aria-labelledby="chapter-action-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id="chapter-action-title">{heading}</h2><button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}><IconX /></button></header>
    {error && <p role="alert">{error}</p>}
    {action.kind === 'create' && <form onSubmit={event => { event.preventDefault(); void run({ type: 'create', path: filename, title }); }}>
      <label>Название новой главы<input autoFocus required value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Имя файла (.md)<input required placeholder="03-chapter.md" value={filename} onChange={event => setFilename(event.target.value)} /></label>
      <button type="submit" disabled={busy}>Создать главу</button>
    </form>}
    {action.kind === 'discover' && <section aria-label="Файлы вне оглавления">
      <p>Только Markdown в этой папке. Исключённые файлы не показываются. Выбранные главы добавятся в конец.</p>
      <button type="button" disabled={busy} onClick={() => void discover().catch(cause => setError(cause instanceof Error ? cause.message : 'Операция не выполнена'))}><IconRefresh size={16} />Обновить список файлов</button>
      {files.length === 0 && <p>Новых файлов нет</p>}
      {files.map(file => <label className="book__discovery-file" key={file.path}><input type="checkbox" checked={selected.includes(file.path)} onChange={event => setSelected(previous => event.target.checked ? [...previous, file.path] : previous.filter(path => path !== file.path))} />{file.path}</label>)}
      <button type="button" disabled={busy || selected.length === 0} onClick={() => void run({ type: 'add', paths: selected })}>Добавить выбранные главы</button>
    </section>}
    {action.kind === 'remove' && entry && <section><p>Убираем «{entry.title || entry.path}» из оглавления. Markdown и файл рецензии останутся на диске.</p></section>}
    {action.kind === 'trash' && entry && <section><p>Markdown «{entry.path}» и связанный файл рецензии (правки, сигналы и заметка) будут перемещены в системную корзину. Глава исчезнет из оглавления. Файлы можно восстановить из корзины.</p><button autoFocus type="button" disabled={busy} onClick={onClose}>Отмена удаления</button><button type="button" disabled={busy} onClick={() => void run({ type: 'trash', chapterId: entry.id })}>Переместить в корзину</button></section>}
    {busy && <p role="status">Сохраняем изменения…</p>}
  </dialog>;
}
