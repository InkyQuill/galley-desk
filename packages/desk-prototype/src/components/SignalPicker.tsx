import type { SignalType } from '../data/fixtures';
import { recordColor } from '../lib/record-format';
import { IconBolt } from '../icons';

type Props = {
  x: number;
  y: number;
  onPick: (type: SignalType) => void;
  onDismiss: () => void;
};

const OPTIONS: { type: SignalType; label: string }[] = [
  { type: 'note', label: 'Заметка' },
  { type: 'change_required', label: 'Требуется правка' },
  { type: 'warning', label: 'Предупреждение' },
  { type: 'review', label: 'На проверку' },
];

export function SignalPicker({ x, y, onPick, onDismiss }: Props) {
  return (
    <div
      role="menu"
      aria-label="Выбор типа сигнала"
      style={{ position: 'fixed', left: x, top: y }}
      className="z-30 flex gap-1 rounded-full bg-app-panel p-1 shadow-[var(--app-card-shadow)]"
      onMouseLeave={onDismiss}
    >
      {OPTIONS.map(({ type, label }) => (
        <button
          key={type}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => onPick(type)}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-app-panel-muted"
        >
          <IconBolt size={14} style={{ color: recordColor(type) }} />
        </button>
      ))}
    </div>
  );
}
