// Подсветка поисковой находки в «Тексте» — отдельная от EditorSelection
// декорация. ChapterSearch должен переходить к находке, не забирая фокус из
// поля поиска и не открывая flyout типа сигнала: оба эффекта в этом редакторе
// завязаны на непустое EditorSelection (см. handleSelection в ReviewEditor),
// поэтому поисковый переход не трогает selection вовсе — только эту
// декорацию и прокрутку.
import { Decoration, EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export type SearchHighlightRange = { from: number; to: number } | null;

/** Устанавливает диапазон подсветки или снимает её (null). */
export const setSearchHighlight = StateEffect.define<SearchHighlightRange>();

function decorate(range: SearchHighlightRange): DecorationSet {
  if (range === null || range.from >= range.to) return Decoration.none;
  return Decoration.set([Decoration.mark({ class: 'gd-search-highlight' }).range(range.from, range.to)]);
}

const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchHighlight)) return decorate(effect.value);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** CM6-расширение подсветки поиска (добавляется рядом с recordMarkers()). */
export function searchHighlight(): Extension {
  return searchHighlightField;
}
