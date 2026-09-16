import type { RecordMarker, SignalType } from '../data/fixtures';

export type RecordDisplay = {
  icon: 'edit' | 'signal';
  colorKey: 'accent' | SignalType;
  label: string;
};

const SIGNAL_LABEL: Record<SignalType, string> = {
  note: 'Заметка',
  change_required: 'Требуется правка',
  warning: 'Предупреждение',
  review: 'На проверку',
};

/** Цвета типов сигналов — семантика Pocket Editor, не зависит от темы
 * (см. спеку: «Семантика цвета сигналов не меняется»). */
const SIGNAL_COLOR: Record<SignalType, string> = {
  note: '#5d7cda',
  change_required: '#c0503f',
  warning: '#c98a3a',
  review: '#5f7d6d',
};

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function recordDisplay(record: RecordMarker, maxLength = 48): RecordDisplay {
  if (record.kind === 'edit') {
    return { icon: 'edit', colorKey: 'accent', label: truncate(`${record.before} → ${record.after}`, maxLength) };
  }
  const label = record.comment.trim().length > 0 ? record.comment : SIGNAL_LABEL[record.signalType];
  return { icon: 'signal', colorKey: record.signalType, label: truncate(label, maxLength) };
}

/** Правки красятся акцентом интерфейса (тема), сигналы — фиксированной
 * Pocket-палитрой, независимой от темы. */
export function recordColor(colorKey: RecordDisplay['colorKey']): string {
  return colorKey === 'accent' ? 'var(--app-accent)' : SIGNAL_COLOR[colorKey];
}

/**
 * Полупрозрачный фон на основе recordColor. color-mix работает и с hex, и
 * с var(--app-accent) — прямая конкатенация цвета со строкой альфа-канала
 * ломается именно на var(), поэтому она здесь не используется.
 */
export function recordBackground(colorKey: RecordDisplay['colorKey'], alphaPercent: number): string {
  return `color-mix(in srgb, ${recordColor(colorKey)} ${alphaPercent}%, transparent)`;
}
