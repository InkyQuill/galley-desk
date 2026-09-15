// Заметка главы: кнопка в правой панели открывает попап с textarea; сохранение
// отправляет Command note. Черновик переживает ошибку сохранения — текст не
// сбрасывается, причина показывается в попапе. Ctrl+Enter сохраняет; Esc
// закрывает без отправки. У полей нет перехвата ввода: undo внутри textarea —
// нативный.
import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

type Props = {
  value: string;
  /** Сохранение через BookWindow; ошибка пробрасывается, черновик остаётся. */
  onCommand: (text: string) => Promise<void>;
};

const cardStyle: CSSProperties = {
  display: 'grid',
  gap: '0.5rem',
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  background: 'Canvas',
  color: 'CanvasText',
};

export function ChapterNote({ value, onCommand }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const openPopup = (): void => {
    // Черновик инициализируется значением главы один раз и дальше живёт сам.
    setDraft((current) => current ?? value);
    setError(null);
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const save = async (): Promise<void> => {
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
            <p role="alert" style={{ color: '#b00020', margin: 0 }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" disabled={busy} onClick={() => void save()}>
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
