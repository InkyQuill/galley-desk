import { useState } from 'react';
import type { RecordMarker } from '../data/fixtures';
import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { IconCheck, IconTrash, IconX } from '../icons';

type Props = {
  record: RecordMarker;
  onClose: () => void;
  onSaveComment: (recordId: string, comment: string) => void;
  onDelete: (recordId: string) => void;
};

export function RecordPopup({ record, onClose, onSaveComment, onDelete }: Props) {
  const [comment, setComment] = useState(record.kind === 'signal' ? record.comment : '');
  const ref = useDismissOnOutsideClick<HTMLDivElement>(onClose);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={record.kind === 'edit' ? 'Правка' : 'Сигнал'}
      className="w-[560px] rounded-2xl bg-app-panel p-4 shadow-[var(--app-card-shadow)]"
    >
      {record.kind === 'edit' ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-app-text-muted">Было:</span> {record.before}
          </p>
          <p>
            <span className="text-app-text-muted">Стало:</span> {record.after}
          </p>
        </div>
      ) : (
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Комментарий…"
          aria-label="Комментарий сигнала"
          className="h-24 w-full resize-none rounded-lg bg-app-panel-muted p-2 text-sm outline-none placeholder:text-app-text-muted"
        />
      )}
      <div className="mt-3 flex justify-end gap-1">
        <button
          type="button"
          title="Удалить"
          aria-label="Удалить"
          onClick={() => {
            onDelete(record.id);
            onClose();
          }}
          className="rounded-lg p-1.5 text-app-error hover:bg-app-panel-muted"
        >
          <IconTrash size={15} />
        </button>
        {record.kind === 'signal' && (
          <button
            type="button"
            title="Сохранить"
            aria-label="Сохранить"
            onClick={() => {
              onSaveComment(record.id, comment);
              onClose();
            }}
            className="rounded-lg p-1.5 text-app-accent hover:bg-app-panel-muted"
          >
            <IconCheck size={15} />
          </button>
        )}
        <button type="button" title="Закрыть" aria-label="Закрыть" onClick={onClose} className="rounded-lg p-1.5 hover:bg-app-panel-muted">
          <IconX size={15} />
        </button>
      </div>
    </div>
  );
}
