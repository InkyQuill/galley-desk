import { useState } from 'react';
import {
  IconAdjustmentsHorizontal,
  IconCode,
  IconDots,
  IconFileText,
  IconGitCompare,
  IconLogout,
  IconSearch,
  IconTarget,
  IconTargetOff,
} from '../icons';
import { findLiteral } from '../lib/search';
import type { ViewMode } from '../types';

type Props = {
  bookTitle: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  zen: boolean;
  onToggleZen: () => void;
  onOpenAppearance: () => void;
  searchText: string;
};

const VIEW_OPTIONS: { mode: ViewMode; label: string; Icon: typeof IconFileText }[] = [
  { mode: 'text', label: 'Текст', Icon: IconFileText },
  { mode: 'comparison', label: 'Сравнение', Icon: IconGitCompare },
  { mode: 'source', label: 'Исходник', Icon: IconCode },
];

export function Header({ bookTitle, viewMode, onViewModeChange, zen, onToggleZen, onOpenAppearance, searchText }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = findLiteral(searchText, query);

  return (
    <header className="flex items-center gap-2 rounded-2xl bg-app-panel px-3 py-2">
      <span className="mr-1 h-2 w-2 rounded-full bg-app-accent" title="Сохранено" aria-hidden="true" />
      <h1 className="flex-1 truncate font-semibold" style={{ fontFamily: 'var(--book-font, inherit)' }}>
        {bookTitle}
      </h1>

      {searchOpen ? (
        <div className="flex items-center gap-2 rounded-lg bg-app-panel-muted px-2 py-1">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query === '') setSearchOpen(false);
            }}
            placeholder="Найти…"
            aria-label="Поиск по главе"
            className="w-40 bg-transparent text-sm outline-none placeholder:text-app-text-muted"
          />
          <span className="text-xs text-app-text-muted">{query === '' ? '' : `${matches.length} совп.`}</span>
          <button type="button" aria-label="Закрыть поиск" onClick={() => setSearchOpen(false)} className="rounded p-1 hover:bg-app-hover">
            <IconSearch size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          title="Поиск по главе"
          aria-label="Поиск по главе"
          onClick={() => setSearchOpen(true)}
          className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-hover"
        >
          <IconSearch size={16} />
        </button>
      )}

      <div className="flex gap-0.5 rounded-lg bg-app-panel-muted p-0.5" role="group" aria-label="Режим просмотра">
        {VIEW_OPTIONS.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={viewMode === mode}
            onClick={() => onViewModeChange(mode)}
            className={`rounded-md p-1.5 ${viewMode === mode ? 'bg-app-panel text-app-text shadow-sm' : 'text-app-text-muted hover:bg-app-hover'}`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <button
        type="button"
        title="Режим Zen"
        aria-label="Режим Zen"
        onClick={onToggleZen}
        className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-hover"
      >
        {zen ? <IconTargetOff size={16} /> : <IconTarget size={16} />}
      </button>

      <div className="relative">
        <button
          type="button"
          title="Ещё"
          aria-label="Ещё"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={`rounded-lg p-1.5 hover:bg-app-hover ${menuOpen ? 'bg-app-hover' : 'text-app-text-muted'}`}
        >
          <IconDots size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-10 w-48 rounded-xl bg-app-panel p-1 shadow-[var(--app-card-shadow)]">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenAppearance();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-app-panel-muted"
            >
              <IconAdjustmentsHorizontal size={14} className="text-app-text-muted" />
              Оформление
            </button>
            <hr className="my-1 border-app-panel-muted" />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-app-error hover:bg-app-panel-muted"
            >
              <IconLogout size={14} />
              Закрыть книгу
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
