import { editKind, recordsInReadingOrder, visualRecord } from '../editor/visual-range';
import type { EditKind } from '../editor/visual-range';
import { IconPencil, IconBolt, IconPlus, IconMinus } from '@tabler/icons-react';
import { EDIT_MARKER_COLOR, deletionColor, useMarkerTheme, signalColor } from '../editor/markers';
// Правая панель рецензии: список правок и сигналов для перехода между ними.
// Панель не содержит форм редактирования — выбор записи открывает тот же
// попап (в BookWindow); у записи без якоря карточка раскрывается прямо здесь.
// Вид правки (вставка/удаление/замена) задаёт одну иконку на карточку, а
// видимые слова «Было»/«Стало» заменены компактными aria-hidden иконками
// minus/plus: полный текст правки остаётся в aria-label/Tooltip.
import type { Command, RecordView } from '../../shared/api';
import { RecordPopup } from './RecordPopup';
import { Tooltip } from '../ui/Tooltip';

import { signalLabels } from './signal-types';

/** Accessible review summary shared by list buttons and their tooltips. */
export function recordLabel(record: RecordView): string {
  const suffix =
    record.status === 'active' ? '' : record.status === 'conflicting' ? ' — конфликтует' : ` — недоступна: ${record.reason}`;
  if (record.kind === 'edit') {
    const labels = { insertion: 'Вставка', deletion: 'Удаление', replacement: 'Замена' };
    return `${labels[editKind(record)]}: ${record.before} → ${record.after}${suffix}`;
  }
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

const editKindIcons: Record<EditKind, typeof IconPencil> = { insertion: IconPlus, deletion: IconMinus, replacement: IconPencil };

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
          const presentation = visualRecord(record);
          const kind = record.kind === 'edit' ? editKind(record) : null;
          const RecordIcon = kind === null ? IconBolt : editKindIcons[kind];
          return (
            <li key={record.id} style={{ display: 'grid', gap: '0.35rem' }}>
              <Tooltip content={recordLabel(record)} describe={false}>
                <button
                  type="button"
                  className={`book__record book__record--${record.status}`}
                  aria-expanded={cardRecordId === record.id}
                  onClick={() => onSelect(record)}
                  aria-label={recordLabel(record)}
                >
                  <RecordIcon
                    aria-hidden="true"
                    size={18}
                    style={{ color: kind === null ? signalColor(record.signalType ?? 'note', theme) : kind === 'deletion' ? deletionColor(theme) : EDIT_MARKER_COLOR }}
                  />
                  <span className="book__record-summary">
                    {kind !== null ? (
                      <>
                        {(kind === 'replacement' || kind === 'deletion') && (
                          <span className="book__record-part">
                            {kind === 'replacement' && <IconMinus aria-hidden="true" size={14} />}
                            {excerpt(presentation.before, 'вставка')}
                          </span>
                        )}
                        {(kind === 'replacement' || kind === 'insertion') && (
                          <span className="book__record-part">
                            {kind === 'replacement' && <IconPlus aria-hidden="true" size={14} />}
                            {excerpt(presentation.after, 'удаление')}
                          </span>
                        )}
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
