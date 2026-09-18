import { useEffect, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import type { BookChange } from '../../shared/api';

export function RenameBookDialog({ title: initialTitle, onChange, onClose }: { title: string; onChange: (change: BookChange) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await onChange({ type: 'rename', title }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция не выполнена'); setBusy(false); }
  };
  return <dialog ref={dialog} className="book__action-dialog" aria-labelledby="rename-book-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id="rename-book-title">Переименовать книгу</h2><button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}><IconX /></button></header>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>Название книги<input autoFocus required value={title} onChange={event => setTitle(event.target.value)} /></label>
      <button type="submit" disabled={busy}>Переименовать книгу</button>
    </form>
    {busy && <p role="status">Сохраняем изменения…</p>}
  </dialog>;
}
