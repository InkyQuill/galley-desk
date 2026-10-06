import { IconArrowUp, IconArrowDown, IconX } from '@tabler/icons-react';
import { Tooltip } from '../ui/Tooltip';
// Панель поиска по главе. Запрос — точная подстрока (findLiteral: UTF-16
// indexOf, без регулярок и замен). Область зависит от вида: «Текст» и
// «Сравнение» ищут по snapshot.text, «Исходник» — по snapshot.sourceText;
// подпись у поля показывает область. Результаты пересчитываются при каждой
// смене снимка (новая ревизия приносит новый текст). Переход к находке
// выполняет BookWindow (прокрутка зависит от вида); комментарии и заметка
// главы в поиск не входят.
import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** Идентификатор открытой главы: отличает смену главы от новой ревизии
   * той же главы (снимок меняется чаще, чем chapterId). */
  chapterId: string;
  onClose: () => void;
  /** Текст области поиска: snapshot.text или snapshot.sourceText. */
  searchText: string;
  /** Переход к находке: выделение и прокрутка (знает вид BookWindow). */
  onReveal: (range: SearchRange) => void;
  /** Снятие поисковой подсветки: пустой запрос, нет совпадений, закрытие панели. */
  onClearHighlight: () => void;
};

export function ChapterSearch({ area, chapterId, searchText, onReveal, onClearHighlight, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Пересчёт при смене текста (ввод, применение правки, смена главы).
  const results = useMemo(() => findLiteral(searchText, query), [searchText, query]);

  // Текст обновился — индекс мог указать за конец: прижимаем к последней находке.
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Смена главы/вида/запроса — переход к первой находке (или снятие
  // подсветки, если находок нет). Ссылки на колбэки, а не сами колбэки, в
  // зависимостях: onReveal у BookWindow пересоздаётся на каждую ревизию
  // (снимок в его deps), и нестабильная ссылка не должна быть поводом для
  // повторного перехода при смене ревизии той же главы. Поэтому searchText
  // намеренно не входит в зависимости этого эффекта -- новая ревизия только
  // пересчитывает results (выше) и клэмпит active (эффект выше), не прыгает.
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const onClearHighlightRef = useRef(onClearHighlight);
  onClearHighlightRef.current = onClearHighlight;
  useEffect(() => {
    setActive(0);
    if (results.length > 0) onRevealRef.current(results[0]!);
    else onClearHighlightRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, area, query]);

  // Панель закрылась (Ctrl+F ещё раз) — подсветка не должна пережить панель.
  useEffect(() => () => onClearHighlightRef.current(), []);

  const goTo = (index: number): void => {
    if (results.length === 0) return;
    const next = ((index % results.length) + results.length) % results.length;
    setActive(next);
    onReveal(results[next]!);
  };

  return (
    <div className="book__search" role="search" aria-label={`Поиск по главе (${AREA_LABELS[area]})`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (query) setQuery('');
        else onClose();
      }}
    >
      <span className="book__search-area">{AREA_LABELS[area]}</span>
      <input
        type="text"
        className="book__search-input"
        aria-label="Поиск по главе"
        placeholder="Найти…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') goTo(event.shiftKey ? active - 1 : active + 1);
        }}
      />
      {/* Счётчик и кнопки -- одна связка раскладки: плотный внутренний шаг,
          при узкой ширине переносится целиком, не разъезжаясь по кнопкам. */}
      <div className="book__search-actions">
        <span className="book__search-counter" aria-live="polite">
          {query === '' ? '' : results.length === 0 ? 'нет совпадений' : `${active + 1}/${results.length}`}
        </span>
        <Tooltip content="Предыдущее совпадение"><button
          type="button"
          aria-label="Предыдущее совпадение"
          disabled={results.length === 0}
          onClick={() => goTo(active - 1)}
        >
          <IconArrowUp />
        </button></Tooltip>
        <Tooltip content="Следующее совпадение"><button
          type="button"
          aria-label="Следующее совпадение"
          disabled={results.length === 0}
          onClick={() => goTo(active + 1)}
        >
          <IconArrowDown />
        </button></Tooltip>
        <Tooltip content="Закрыть поиск">
          <button type="button" aria-label="Закрыть поиск" onClick={onClose}><IconX /></button>
        </Tooltip>
      </div>
    </div>
  );
}
