import { useRef, useState } from 'react';
import { useAppearance } from '../appearance/AppearanceProvider';
import type { Chapter, RecordMarker } from '../data/fixtures';
import { markText } from '../lib/marked-text';
import { recordBackground, recordColor, recordDisplay } from '../lib/record-format';
import { IconBolt, IconPencil } from '../icons';
import { EditFlyout } from './EditFlyout';

type Props = {
  chapter: Chapter;
  records: RecordMarker[];
  onMarkerActivate: (recordId: string) => void;
  onTextSelect: (selection: { from: number; to: number; x: number; y: number }) => void;
};

function textOffsetOf(root: Node, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
    if (current === node) return consumed + offset;
    consumed += (current as Text).data.length;
  }
  return null;
}

function resolveSelectionOffsets(root: Node, selection: Selection): { from: number; to: number } | null {
  if (selection.anchorNode === null || selection.focusNode === null) return null;
  const a = textOffsetOf(root, selection.anchorNode, selection.anchorOffset);
  const b = textOffsetOf(root, selection.focusNode, selection.focusOffset);
  if (a === null || b === null) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function ChapterContent({ chapter, records, onMarkerActivate, onTextSelect }: Props) {
  const { appearance } = useAppearance();
  const [activeFlyoutId, setActiveFlyoutId] = useState<string | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const segments = markText(chapter.text, records);

  const handleMouseUp = (): void => {
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || textRef.current === null) return;
    const text = selection.toString();
    if (text.trim().length === 0) return;
    const offsets = resolveSelectionOffsets(textRef.current, selection);
    if (offsets === null) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    onTextSelect({ ...offsets, x: rect.left, y: rect.bottom + window.scrollY });
    selection.removeAllRanges();
  };

  return (
    <section className="mx-auto flex h-full flex-col" style={{ width: `min(100%, ${appearance.lineWidth}px)` }}>
      <h2 className="mb-2 flex-none text-sm text-app-text-muted">{chapter.title}</h2>
      <div className="flex flex-1 gap-2 overflow-y-auto rounded-2xl bg-app-panel p-5 shadow-[var(--app-card-shadow)]">
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
        <p
          ref={textRef}
          onMouseUp={handleMouseUp}
          className="flex-1 leading-relaxed"
          style={{ fontFamily: appearance.bookFontFamily }}
        >
          {segments.map((segment, index) => {
            if (segment.record === null) return <span key={index}>{segment.text}</span>;
            const record = segment.record;
            const display = recordDisplay(record);
            const highlightStyle =
              record.kind === 'edit'
                ? { backgroundColor: recordBackground(display.colorKey, 28) }
                : {
                    backgroundImage: `linear-gradient(${recordBackground(display.colorKey, 55)}, ${recordBackground(display.colorKey, 55)})`,
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
