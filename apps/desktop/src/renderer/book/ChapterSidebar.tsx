import { useCallback, useRef, useState } from 'react';
import { IconFilePlus, IconFolderSearch, IconDots, IconSortAscending, IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';
import type { BookView } from '../../shared/api';
import { Tooltip } from '../ui/Tooltip';
import { matchesChapter } from './chapter-filter';
import { ChapterMenu } from './ChapterMenu';

export type ChapterAction =
  | { kind: 'create' | 'discover' }
  | { kind: 'sort'; filterActive: boolean }
  | { kind: 'remove' | 'trash'; chapterId: string };

export type ChapterSidebarProps = {
  book: BookView;
  activeId: string | null;
  disabled: boolean;
  onOpen(id: string): void;
  onAction(action: ChapterAction): void;
  /** Скрыть панель оглавления (кнопка в заголовке панели). */
  onCollapse(): void;
};

export function ChapterSidebar({ book, activeId, disabled, onOpen, onAction, onCollapse }: ChapterSidebarProps) {
  const [filter, setFilter] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const dismissMenu = useCallback(() => setMenuId(null), []);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = book.entries.filter(entry => matchesChapter(entry, filter));


  return (
    <nav className="book__chapters" aria-label="Оглавление">
      <div className="book__chapters-heading">
        <h2 className="book__panel-title">Оглавление</h2>
        <div className="book__chapter-tools">
          <Tooltip content="Добавить главу"><button type="button" aria-label="Добавить главу" disabled={disabled} onClick={() => onAction({ kind: 'create' })}><IconFilePlus /></button></Tooltip>
          <Tooltip content="Сортировать главы"><button type="button" aria-label="Сортировать главы" disabled={disabled || book.entries.length === 0} onClick={() => onAction({ kind: 'sort', filterActive: filter.trim().length > 0 })}><IconSortAscending /></button></Tooltip>
          <Tooltip content="Найти главы в папке"><button type="button" aria-label="Найти главы в папке" disabled={disabled} onClick={() => onAction({ kind: 'discover' })}><IconFolderSearch /></button></Tooltip>
          <Tooltip content="Скрыть оглавление"><button type="button" className="book__panel-collapse" aria-label="Скрыть оглавление" onClick={onCollapse}><IconLayoutSidebarLeftCollapse /></button></Tooltip>
        </div>
      </div>
      <input type="text" className="book__chapter-filter" aria-label="Фильтр глав" placeholder="Фильтр глав…" value={filter} onChange={event => setFilter(event.target.value)} />
      {visible.map(entry => {
        const label = entry.title || entry.path;
        const active = entry.id === activeId;
        return (
          <div key={entry.id} className={`book__chapter-row${active ? ' book__chapter-row--active' : ''}${menuId === entry.id ? ' book__chapter-row--menu' : ''}`}>
            <Tooltip content={entry.missing ? 'Файл главы отсутствует' : entry.path}>
              <button type="button" className="book__chapter" aria-label={label} disabled={entry.missing} onClick={() => onOpen(entry.id)}>
                <span className="book__chapter-name">{label}</span>
                <small>{entry.path.split('/').pop()}{entry.missing ? ' (файл отсутствует)' : ''}</small>
              </button>
            </Tooltip>
            <div className="book__chapter-menu" ref={menuId === entry.id ? menuRef : undefined} onKeyDown={event => { if (event.key === 'Escape' && menuId === entry.id) { event.stopPropagation(); setMenuId(null); event.currentTarget.querySelector<HTMLButtonElement>('.book__chapter-menu-button')?.focus(); } }}>
              <Tooltip content={`Действия главы: ${label}`}>
                <button type="button" className="book__chapter-menu-button" data-chapter-menu-id={entry.id} aria-label={`Действия главы: ${label}`} aria-expanded={menuId === entry.id} disabled={disabled} onClick={() => setMenuId(current => current === entry.id ? null : entry.id)}><IconDots /></button>
              </Tooltip>
              {menuId === entry.id && <ChapterMenu anchor={menuRef} onDismiss={dismissMenu} onAction={kind => { setMenuId(null); onAction({ kind, chapterId: entry.id }); }} />}
            </div>
          </div>
        );
      })}
      {visible.length === 0 && <p className="book__chapters-empty">Главы не найдены</p>}
    </nav>
  );
}
