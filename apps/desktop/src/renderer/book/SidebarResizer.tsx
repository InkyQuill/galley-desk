import { useEffect, useRef } from 'react';
import { DEFAULT_LAYOUT, SIDEBAR_BOUNDS } from '../../shared/layout';

export type SidebarResizerProps = {
  side: 'chapters' | 'review';
  value: number;
  onPreview(value: number): void;
  onCommit(value: number): void;
  onCancel(): void;
};

const KEYBOARD_COMMIT_MS = 250;
const KEYBOARD_STEP = 16;
const clamp = (value: number): number =>
  Math.min(SIDEBAR_BOUNDS.max, Math.max(SIDEBAR_BOUNDS.min, Math.round(value)));

export function SidebarResizer({ side, value, onPreview, onCommit, onCancel }: SidebarResizerProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const latestRef = useRef(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = value;

  const clearCommitTimer = (): void => {
    if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  };

  useEffect(() => () => {
    clearCommitTimer();
    document.documentElement.classList.remove('is-resizing-sidebar');
  }, []);

  const finishDrag = (commit: boolean): void => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    document.documentElement.classList.remove('is-resizing-sidebar');
    if (commit) onCommit(latestRef.current);
    else onCancel();
  };

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || dragRef.current === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishDrag(false);
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  });

  const scheduleCommit = (next: number): void => {
    clearCommitTimer();
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      onCommit(next);
    }, KEYBOARD_COMMIT_MS);
  };

  return (
    <div
      className="book__sidebar-resizer"
      data-side={side}
      role="separator"
      aria-label={side === 'chapters' ? 'Ширина оглавления' : 'Ширина рецензии'}
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_BOUNDS.min}
      aria-valuemax={SIDEBAR_BOUNDS.max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        clearCommitTimer();
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: value };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.classList.add('is-resizing-sidebar');
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.startX;
        const next = clamp(drag.startWidth + (side === 'chapters' ? delta : -delta));
        latestRef.current = next;
        onPreview(next);
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        finishDrag(true);
      }}
      onPointerCancel={() => finishDrag(false)}
      onDoubleClick={() => {
        const next = DEFAULT_LAYOUT[side === 'chapters' ? 'chaptersWidth' : 'reviewWidth'];
        clearCommitTimer();
        latestRef.current = next;
        onPreview(next);
        onCommit(next);
      }}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === 'ArrowLeft') next = clamp(value + (side === 'chapters' ? -KEYBOARD_STEP : KEYBOARD_STEP));
        if (event.key === 'ArrowRight') next = clamp(value + (side === 'chapters' ? KEYBOARD_STEP : -KEYBOARD_STEP));
        if (event.key === 'Home') next = SIDEBAR_BOUNDS.min;
        if (event.key === 'End') next = SIDEBAR_BOUNDS.max;
        if (next === null) return;
        event.preventDefault();
        latestRef.current = next;
        onPreview(next);
        scheduleCommit(next);
      }}
    />
  );
}
