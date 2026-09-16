import type { RecordMarker } from '../data/fixtures';
import { recordColor, recordDisplay } from '../lib/record-format';
import { IconBolt, IconPencil } from '../icons';

type Props = {
  chapterNote: string;
  records: RecordMarker[];
  onSelect: (recordId: string) => void;
};

export function ReviewSidebar({ chapterNote, records, onSelect }: Props) {
  return (
    <aside aria-label="Рецензия" className="flex w-56 flex-none flex-col gap-2 rounded-2xl bg-app-panel p-3">
      {chapterNote !== '' && <p className="rounded-lg bg-app-panel-muted p-2 text-xs text-app-text-muted">{chapterNote}</p>}
      <ul className="flex flex-col gap-1">
        {records.map((record) => {
          const display = recordDisplay(record);
          const Icon = display.icon === 'edit' ? IconPencil : IconBolt;
          return (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => onSelect(record.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-panel-muted"
              >
                <Icon size={14} style={{ color: recordColor(display.colorKey) }} className="flex-none" />
                <span className="truncate">{display.label}</span>
              </button>
            </li>
          );
        })}
        {records.length === 0 && <li className="px-2 text-sm text-app-text-muted">Записей пока нет</li>}
      </ul>
    </aside>
  );
}
