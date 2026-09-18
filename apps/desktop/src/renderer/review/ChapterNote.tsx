// Заметка главы: кнопка в правой панели открывает попап с textarea; сохранение
// отправляет Command note. Черновик переживает ошибку сохранения — текст не
// сбрасывается, причина показывается в попапе. Ctrl+Enter сохраняет; Esc
// закрывает без отправки. У полей нет перехвата ввода: undo внутри textarea —
// нативный.
import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

type Props = {
  value: string;
  state: NoteState;
  onState: (change: Partial<NoteState>) => void;
  readOnly?: boolean;
  /** Сохранение через BookWindow; ошибка пробрасывается, черновик остаётся. */
  onCommand: (text: string) => Promise<void>;
};

export type NoteState = { open: boolean; draft: string | null; error: string | null; busy: boolean };
export const emptyNoteState: NoteState = { open: false, draft: null, error: null, busy: false };

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: '0.5rem',
  padding: '0.75rem',
  borderRadius: 8,
  border: 'none',
  background: 'var(--app-panel)',
  color: 'var(--app-text)',
};

export function ChapterNote({ value, state, onState, onCommand, readOnly = false }: Props) {
  const { open, draft, error, busy } = state;
  const setOpen = (open: boolean) => onState({ open });
  const setDraft = (draft: string) => onState({ draft });
  const setError = (error: string | null) => onState({ error });
  const setBusy = (busy: boolean) => onState({ busy });
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const openPopup = (): void => {
    // Черновик инициализируется значением главы один раз и дальше живёт сам.
    setDraft(draft ?? value);
    setError(null);
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const save = async (): Promise<void> => {
    if (readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await onCommand(draft ?? '');
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить заметку');
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="chapter-note" style={{ display: 'grid', gap: '0.35rem' }}>
      <button ref={buttonRef} type="button" onClick={openPopup}>
        Заметка главы
      </button>
      {open && (
        <div role="dialog" aria-label="Заметка главы" style={cardStyle} onKeyDown={onKeyDown}>
          <textarea
            readOnly={readOnly}
            autoFocus
            aria-label="Текст заметки"
            rows={5}
            value={draft ?? ''}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save();
            }}
          />
          {error !== null && (
            <p role="alert" style={{ color: 'var(--app-error-text)', margin: 0 }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" disabled={busy || readOnly} onClick={() => void save()}>
              Сохранить
            </button>
            <button type="button" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
