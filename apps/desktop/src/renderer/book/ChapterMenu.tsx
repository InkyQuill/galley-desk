import { useEffect, useRef, type RefObject } from 'react';
import { AnchoredLayer } from '../ui/AnchoredLayer';
import { IconMinus, IconTrash } from '@tabler/icons-react';

export function ChapterMenu({ anchor, onDismiss, onAction }: { anchor: RefObject<HTMLElement | null>; onDismiss: () => void; onAction: (kind: 'remove' | 'trash') => void }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!content.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [anchor, onDismiss]);
  return (
    <AnchoredLayer anchor={anchor} className="book__chapter-menu-items"><div ref={content} aria-label="Действия главы">
      <button type="button" onClick={() => onAction('remove')}><IconMinus />Убрать из оглавления</button>
      <button type="button" className="book__chapter-trash" onClick={() => onAction('trash')}><IconTrash />Переместить в корзину…</button>
    </div></AnchoredLayer>
  );
}
