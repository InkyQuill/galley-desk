import { IconArrowUp, IconArrowDown, IconX } from '@tabler/icons-react';
// Панель поиска по главе. Запрос — точная подстрока (findLiteral: UTF-16
// indexOf, без регулярок и замен). Область зависит от вида: «Текст» и
// «Сравнение» ищут по snapshot.text, «Исходник» — по snapshot.sourceText;
// подпись у поля показывает область. Результаты пересчитываются при каждой
// смене снимка (новая ревизия приносит новый текст). Переход к находке
// выполняет BookWindow (прокрутка зависит от вида); комментарии и заметка
// главы в поиск не входят.
import { useEffect, useMemo, useState } from 'react';
import { findLiteral } from './search';
import type { SearchRange } from './search';

export type SearchArea = 'text' | 'comparison' | 'source';

const AREA_LABELS: Record<SearchArea, string> = {
  text: 'Текст',
  comparison: 'Сравнение',
  source: 'Исходник',
};

type Props = {
  area: SearchArea;
  onClose: () => void;
  /** Текст области поиска: snapshot.text или snapshot.sourceText. */
  searchText: string;
  /** Переход к находке: выделение и прокрутка (знает вид BookWindow). */
  onReveal: (range: SearchRange) => void;
};

export function ChapterSearch({ area, searchText, onReveal, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Пересчёт при смене текста (ввод, применение правки, смена главы).
  const results = useMemo(() => findLiteral(searchText, query), [searchText, query]);

  // Текст обновился — индекс мог указать за конец: прижимаем к последней находке.
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  const goTo = (index: number): void => {
    if (results.length === 0) return;
    const next = ((index % results.length) + results.length) % results.length;
    setActive(next);
    onReveal(results[next]!);
  };

  return (
    <div className="book__search" role="search" aria-label={`Поиск по главе (${AREA_LABELS[area]})`}>
      <span className="book__search-area">{AREA_LABELS[area]}</span>
      <input
        type="text"
        className="book__search-input"
        aria-label="Поиск по главе"
        placeholder="Найти…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); if (query) setQuery(''); else onClose(); }
          if (event.key === 'Enter') goTo(event.shiftKey ? active - 1 : active + 1);
        }}
      />
      <span className="book__search-counter" aria-live="polite">
        {query === '' ? '' : results.length === 0 ? 'нет совпадений' : `${active + 1}/${results.length}`}
      </span>
      <button
        type="button"
        aria-label="Предыдущее совпадение"
        disabled={results.length === 0}
        onClick={() => goTo(active - 1)}
      >
        <IconArrowUp />
      </button>
      <button
        type="button"
        aria-label="Следующее совпадение"
        disabled={results.length === 0}
        onClick={() => goTo(active + 1)}
      >
        <IconArrowDown />
      </button>
      <button type="button" aria-label="Закрыть поиск" title="Закрыть поиск" onClick={onClose}><IconX /></button>
    </div>
  );
}
