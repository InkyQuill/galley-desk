import { useState } from 'react';
import type { Chapter } from '../data/fixtures';

type Props = {
  chapters: Chapter[];
  activeChapterId: string;
  onSelect: (chapterId: string) => void;
};

export function ChapterSidebar({ chapters, activeChapterId, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const normalized = filter.trim().toLowerCase();
  const visible = normalized === '' ? chapters : chapters.filter((chapter) => chapter.title.toLowerCase().includes(normalized));

  return (
    <nav aria-label="Оглавление" className="flex w-48 flex-col gap-1 rounded-2xl bg-app-panel p-3">
      <input
        type="text"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Фильтр глав…"
        aria-label="Фильтр глав"
        className="mb-1 rounded-lg bg-app-panel-muted px-2 py-1 text-sm outline-none placeholder:text-app-text-muted"
      />
      {visible.map((chapter) => (
        <button
          key={chapter.id}
          type="button"
          disabled={chapter.missing === true}
          title={chapter.missing === true ? 'Файл главы отсутствует' : chapter.title}
          onClick={() => onSelect(chapter.id)}
          className={`rounded-lg px-2 py-1.5 text-left text-sm ${
            chapter.id === activeChapterId ? 'bg-app-hover font-medium text-app-text' : 'text-app-text-muted hover:bg-app-hover'
          } ${chapter.missing === true ? 'cursor-default opacity-45' : ''}`}
        >
          {chapter.title}
        </button>
      ))}
      {visible.length === 0 && <p className="px-2 text-sm text-app-text-muted">Главы не найдены</p>}
    </nav>
  );
}
