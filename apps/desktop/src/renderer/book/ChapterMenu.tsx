import { IconMinus, IconTrash } from '@tabler/icons-react';

export function ChapterMenu({ onAction }: { onAction: (kind: 'remove' | 'trash') => void }) {
  return (
    <div className="book__chapter-menu-items" aria-label="Действия главы">
      <button type="button" onClick={() => onAction('remove')}><IconMinus />Убрать из оглавления</button>
      <button type="button" className="book__chapter-trash" onClick={() => onAction('trash')}><IconTrash />Переместить в корзину…</button>
    </div>
  );
}
