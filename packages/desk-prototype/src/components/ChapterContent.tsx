import { useState } from 'react';
import { useAppearance } from '../appearance/AppearanceProvider';
import type { Chapter, RecordMarker } from '../data/fixtures';
import { markText } from '../lib/marked-text';
import { recordColor, recordDisplay } from '../lib/record-format';
import { IconBolt, IconPencil } from '../icons';
import { EditFlyout } from './EditFlyout';

type Props = {
  chapter: Chapter;
  records: RecordMarker[];
  onMarkerActivate: (recordId: string) => void;
};

export function ChapterContent({ chapter, records, onMarkerActivate }: Props) {
  const { appearance } = useAppearance();
  const [activeFlyoutId, setActiveFlyoutId] = useState<string | null>(null);
  const segments = markText(chapter.text, records);

  return (
    <section className="mx-auto" style={{ width: `min(100%, ${appearance.lineWidth}px)` }}>
      <h2 className="mb-2 text-sm text-app-text-muted">{chapter.title}</h2>
      <div className="flex gap-2 rounded-2xl bg-app-panel p-5 shadow-[var(--app-card-shadow)]">
        <div className="flex w-5 flex-none flex-col items-center gap-1 pt-1" aria-hidden="true">
          {records.map((record) => {
            const display = recordDisplay(record);
            const Icon = display.icon === 'edit' ? IconPencil : IconBolt;
            return (
              <button
                key={record.id}
                type="button"
                title={display.label}
                onClick={() => onMarkerActivate(record.id)}
                className="rounded p-0.5 hover:bg-app-hover"
                style={{ color: recordColor(display.colorKey) }}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
        <p className="flex-1 leading-relaxed" style={{ fontFamily: appearance.bookFontFamily }}>
          {segments.map((segment, index) => {
            if (segment.record === null) return <span key={index}>{segment.text}</span>;
            const record = segment.record;
            const display = recordDisplay(record);
            const color = recordColor(display.colorKey);
            const highlightStyle =
              record.kind === 'edit'
                ? { boxShadow: `inset 0 0 0 100vw ${color}22` }
                : {
                    backgroundImage: `linear-gradient(${color}55, ${color}55)`,
                    backgroundRepeat: 'no-repeat' as const,
                    backgroundSize: '100% 34%',
                    backgroundPosition: 'bottom' as const,
                  };
            return (
              <span
                key={index}
                tabIndex={0}
                role="button"
                onMouseEnter={() => setActiveFlyoutId(record.id)}
                onMouseLeave={() => setActiveFlyoutId((current) => (current === record.id ? null : current))}
                onFocus={() => setActiveFlyoutId(record.id)}
                onBlur={() => setActiveFlyoutId((current) => (current === record.id ? null : current))}
                onClick={() => onMarkerActivate(record.id)}
                className="relative cursor-pointer rounded-sm outline-none"
                style={highlightStyle}
              >
                {segment.text}
                {activeFlyoutId === record.id && record.kind === 'edit' && <EditFlyout before={record.before} />}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}
