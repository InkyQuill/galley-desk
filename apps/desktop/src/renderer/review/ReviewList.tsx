import { recordsInReadingOrder } from '../editor/visual-range';
import { IconPencil, IconBolt } from '@tabler/icons-react';
import { EDIT_MARKER_COLOR, useMarkerTheme, signalColor } from '../editor/markers';
// Правая панель рецензии: список правок и сигналов для перехода между ними.
// Панель не содержит форм редактирования — выбор записи открывает тот же
// попап (в BookWindow); у записи без якоря карточка раскрывается прямо здесь.
import type { Command, RecordView } from '../../shared/api';
import { RecordPopup } from './RecordPopup';
import { Tooltip } from '../ui/Tooltip';

/** Единая подпись записи для списка и тестов. */
const signalLabels = { note: 'Заметка', change_required: 'Требуется правка', warning: 'Предупреждение', review: 'На проверку' };

export function recordLabel(record: RecordView): string {
  const suffix =
    record.status === 'active' ? '' : record.status === 'conflicting' ? ' — конфликтует' : ` — недоступна: ${record.reason}`;
  if (record.kind === 'edit') return `Правка: ${record.before} → ${record.after}${suffix}`;
  const comment = record.comment.length > 0 ? `: ${record.comment}` : '';
  return `Сигнал [${record.signalType ?? ''}]${comment}${suffix}`;
}

function statusLabel(record: RecordView): string | null {
  if (record.status === 'conflicting') return 'Конфликтует';
  if (record.status === 'unavailable') return `Недоступна: ${record.reason}`;
  return null;
}

function excerpt(value: string, emptyLabel: string) {
  return <span className={`book__record-excerpt${value.length === 0 ? ' book__record-excerpt--empty' : ''}`}>{value || emptyLabel}</span>;
}

type Props = {
  readOnly?: boolean;
  records: RecordView[];
  /** Запись, чья карточка раскрыта в панели (нет якоря или переход невозможен). */
  cardRecordId: string | null;
  onSelect: (record: RecordView) => void;
  onCommand: (command: Command) => void;
  onCardClose: () => void;
};

export function ReviewList({ records, cardRecordId, onSelect, onCommand, onCardClose, readOnly = false }: Props) {
  const theme = useMarkerTheme();
  if (records.length === 0) return null;
  return (
    <nav aria-label="Рецензия главы" style={{ display: 'grid', gap: '0.25rem' }}>
      <ul className="book__records">
        {recordsInReadingOrder(records).map((record) => {
          const status = statusLabel(record);
          return (
            <li key={record.id} style={{ display: 'grid', gap: '0.35rem' }}>
              <Tooltip content={recordLabel(record)}>
                <button
                  type="button"
                  className={`book__record book__record--${record.status}`}
                  aria-expanded={cardRecordId === record.id}
                  onClick={() => onSelect(record)}
                  aria-label={recordLabel(record)}
                >
                  {record.kind === 'edit' ? <IconPencil style={{ color: EDIT_MARKER_COLOR }} /> : <IconBolt style={{ color: signalColor(record.signalType ?? 'note', theme) }} />}
                  <span className="book__record-summary">
                    {record.kind === 'edit' ? (
                      <>
                        <span className="book__record-part"><span className="book__record-label">Было</span>{excerpt(record.before, 'вставка')}</span>
                        <span className="book__record-part"><span className="book__record-label">Стало</span>{excerpt(record.after, 'удаление')}</span>
                      </>
                    ) : (
                      <>
                        <span className="book__record-signal-type">{signalLabels[record.signalType ?? 'note']}</span>
                        {excerpt(record.comment, 'Без комментария')}
                      </>
                    )}
                    {status !== null && <span className="book__record-status">{status}</span>}
                  </span>
                </button>
              </Tooltip>
              {cardRecordId === record.id && (
                <RecordPopup readOnly={readOnly} record={record} at={null} onCommand={onCommand} onClose={onCardClose} />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
