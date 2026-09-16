// Marker decorations of review records over the derived text (pure function of
// RecordView[] + document). RecordView.from/to are UTF-16 positions of the SAME
// derived text as the editor document, so mapping is direct; between snapshots
// the built DecorationSet is mapped through ordinary document changes (the
// StateField below) and rebuilt fresh on every setRecordMarkers effect.
//
// Взаимодействие тем и маркеров: цвета сигналов, правок и подложек —
// НЕЗАВИСИМЫЕ константы, скопированные из Pocket Editor (Color.kt); они
// остаются Pocket-совместимыми поверх любой темы оформления. Темам Galley
// принадлежат поверхности приложения и редактора (CSS-переменные на
// контейнере окна, см. Appearance.tsx/BookWindow.tsx); от темы маркерам
// достаётся только выбор светлого/тёмного набора — активную схему задаёт
// BookWindow после загрузки настроек оформления (setActiveScheme), до этого
// действует prefers-color-scheme системы.
// Источник цветов:
// /home/inky/Development/pocket-editor/app/src/main/java/net/inkyquill/pocketeditor/ui/theme/Color.kt
// (LightReviewColors/DarkReviewColors; оттенки правок — Umber/Amber и
// deletion/additionContainer оттуда же). Рендерер не может импортировать
// Kotlin, поэтому значения захардкожены здесь.
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter } from '@codemirror/view';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconBolt, IconPencil, IconTrash } from '@tabler/icons-react';
import { Range, StateEffect, StateField } from '@codemirror/state';
import { useSyncExternalStore } from 'react';
import type { DecorationSet } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import { visualRecord, recordsInReadingOrder } from './visual-range';
import type { RecordView } from '../../shared/api';

export const SIGNAL_TYPES = ['note', 'change_required', 'warning', 'review'] as const;
export type SignalTypeName = (typeof SIGNAL_TYPES)[number];
export type ThemeName = 'light' | 'dark';

/** Shared ordinary-edit icon color; follows the active application theme. */
export const EDIT_MARKER_COLOR = 'var(--desk-accent)';

/** Four signal type colors per theme, copied from Pocket Editor Color.kt. */
export const SIGNAL_TYPE_COLORS: Record<ThemeName, Record<SignalTypeName, string>> = {
  light: {
    note: '#1E5A9B',
    change_required: '#A62B2B',
    warning: '#795900',
    review: '#7545A5',
  },
  dark: {
    note: '#86B9F2',
    change_required: '#FF9290',
    warning: '#F2CB68',
    review: '#D2A7FF',
  },
};

/** Comparison tints (deletion/addition containers) from the same Color.kt. */
export const COMPARISON_TINTS: Record<ThemeName, { deletion: string; addition: string }> = {
  light: { deletion: '#FFDFDC', addition: '#DCEEDD' },
  dark: { deletion: '#4A2524', addition: '#203B28' },
};

/** Neutral tint for an edit range (Umber/Amber from the same Color.kt). */
export function editRangeTint(theme: ThemeName): string {
  return theme === 'dark' ? 'rgba(233,166,106,0.20)' : 'rgba(103,91,80,0.14)';
}

/** Marker color of a pure deletion (ReviewColors.deletion from Color.kt). */
export function deletionColor(theme: ThemeName): string {
  return theme === 'dark' ? '#FF9B97' : '#A42E2E';
}

export function signalColor(type: SignalTypeName, theme: ThemeName): string {
  return SIGNAL_TYPE_COLORS[theme][type];
}

export function comparisonTint(kind: 'deletion' | 'addition', theme: ThemeName): string {
  return COMPARISON_TINTS[theme][kind];
}

// --- theme scheme store ------------------------------------------------------

/**
 * Реактивная схема маркеров: BookWindow вызывает setActiveScheme при загрузке
 * и смене темы оформления; компоненты (подложки, попапы, flyout, виджеты)
 * подписываются через useMarkerTheme и перерисовываются вместе с темой.
 * Сами цвета при любой схеме — константы Pocket Editor из таблиц выше.
 */
type SchemeListener = () => void;

const schemeListeners = new Set<SchemeListener>();
let activeScheme: ThemeName | null = null;

/** Схема активной темы оформления; null возвращает системную схему. */
export function setActiveScheme(scheme: ThemeName | null): void {
  if (activeScheme === scheme) return;
  activeScheme = scheme;
  for (const listener of [...schemeListeners]) listener();
}

export function subscribeScheme(listener: SchemeListener): () => void {
  schemeListeners.add(listener);
  return () => {
    schemeListeners.delete(listener);
  };
}

/** Current marker palette scheme (settings-driven, falls back to the OS). */
export function currentTheme(): ThemeName {
  if (activeScheme !== null) return activeScheme;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Реактивный вариант currentTheme для рендера: смена темы перерисовывает. */
export function useMarkerTheme(): ThemeName {
  return useSyncExternalStore(subscribeScheme, currentTheme, (): ThemeName => 'light');
}

// --- decorations -------------------------------------------------------------

/** Rebuilds the marker decorations from fresh RecordViews. */
export const setRecordMarkers = StateEffect.define<RecordView[]>();

/** All interactive geometry reads this field, including while acknowledgements lag. */
export const mappedRecords = StateField.define<RecordView[]>({
  create: () => [],
  update(records, tr) {
    let next = tr.docChanged ? records.map((record) => {
      if (record.from === null || record.to === null) return record;
      const from = tr.changes.mapPos(record.from, 1);
      const to = tr.changes.mapPos(record.to, record.from === record.to ? 1 : -1);
      return { ...record, from: Math.min(from, to), to: Math.max(from, to) };
    }) : records;
    for (const effect of tr.effects) {
      if (effect.is(setRecordMarkers)) next = effect.value.filter((record) =>
        record.status === 'active' && record.from !== null && record.to !== null &&
        record.from >= 0 && record.from <= record.to && record.to <= tr.state.doc.length);
    }
    return next;
  },
});

/** Trim on authoritative snapshots only; pending input maps the presentation range itself. */
export const mappedVisualRecords = StateField.define<RecordView[]>({
  create: () => [],
  update(records, tr) {
    if (tr.effects.some((effect) => effect.is(setRecordMarkers))) {
      return tr.state.field(mappedRecords).map(visualRecord);
    }
    if (!tr.docChanged) return records;
    return records.map((record) => {
      if (record.from === null || record.to === null) return record;
      const from = tr.changes.mapPos(record.from, 1);
      const to = tr.changes.mapPos(record.to, record.from === record.to ? 1 : -1);
      return { ...record, from: Math.min(from, to), to: Math.max(from, to) };
    });
  },
});

class AnnotationWidget extends WidgetType {
  constructor(readonly record: RecordView, readonly theme: ThemeName) { super(); }
  eq(other: AnnotationWidget): boolean {
    return this.record.id === other.record.id && this.record.comment === other.record.comment &&
      this.record.before === other.record.before && this.record.signalType === other.record.signalType && this.theme === other.theme;
  }
  toDOM(): HTMLElement {
    const deletion = this.record.kind === 'edit';
    const dom = document.createElement(deletion ? 'button' : 'div');
    dom.className = deletion ? 'gd-deletion-placeholder' : 'gd-signal-comment';
    dom.dataset.recordId = this.record.id;
    dom.contentEditable = 'false';
    dom.style.color = deletion ? deletionColor(this.theme) : signalColor(this.record.signalType ?? 'note', this.theme);
    if (deletion) {
      (dom as HTMLButtonElement).type = 'button';
      dom.setAttribute('aria-label', 'Удалённый текст');
      dom.innerHTML = trash;
    } else dom.textContent = this.record.comment;
    return dom;
  }
  coordsAt(dom: HTMLElement): { left: number; right: number; top: number; bottom: number } | null {
    if (this.record.kind !== 'edit') return null;
    const view = EditorView.findFromDOM(dom);
    if (!view) return null;
    const pos = view.posAtDOM(dom);
    const line = view.state.doc.lineAt(pos);
    // The small icon must not redefine the text caret/scroll anchor's height.
    const text = pos < line.to ? view.coordsForChar(pos) : pos > line.from ? view.coordsForChar(pos - 1) : null;
    if (!text) return null;
    const icon = dom.getBoundingClientRect();
    return { left: icon.left, right: icon.left, top: text.top, bottom: text.bottom };
  }
  ignoreEvent(): boolean { return true; }
}

/** Widgets never alter the document, storage coordinates or CM clipboard text. */
export function buildDecorations(records: RecordView[], doc: Text, theme: ThemeName = currentTheme()): DecorationSet {
  return decorateVisualRecords(records.map(visualRecord), doc, theme);
}

function decorateVisualRecords(records: RecordView[], doc: Text, theme: ThemeName): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const record of recordsInReadingOrder(records)) {
    if (record.status !== 'active' || record.from === null || record.to === null ||
        record.from < 0 || record.from > record.to || record.to > doc.length) continue;
    if (record.kind === 'edit' && record.from === record.to && record.before !== '') {
      ranges.push(Decoration.widget({ widget: new AnnotationWidget(record, theme), side: 1 }).range(record.from));
    }
    if (record.kind === 'signal' && record.comment !== '') {
      let line = doc.lineAt(record.to > record.from ? record.to - 1 : record.to);
      // A selected separator belongs to the paragraph before it, not the next one.
      while (line.number > 1 && line.text.trim() === '') line = doc.line(line.number - 1);
      while (line.number < doc.lines && doc.line(line.number + 1).text.trim() !== '') line = doc.line(line.number + 1);
      ranges.push(Decoration.widget({ widget: new AnnotationWidget(record, theme), block: true, side: 1 }).range(line.to));
    }
    if (record.from === record.to) continue;
    const color = signalColor(record.signalType ?? 'note', theme);
    ranges.push(Decoration.mark({
      class: record.kind === 'edit' ? 'gd-edit-range' : `gd-signal-range gd-signal-range--${record.signalType ?? 'note'}`,
      attributes: {
        'data-record-id': record.id,
        style: record.kind === 'edit' ? `background-color:${editRangeTint(theme)}` :
          `background:linear-gradient(to bottom,transparent 66%,color-mix(in srgb,${color} 24%,transparent) 66%)`,
      },
    }).range(record.from, record.to));
  }
  return Decoration.set(ranges, true);
}

const recordMarkersField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    if (tr.effects.some((effect) => effect.is(setRecordMarkers))) {
      return decorateVisualRecords(tr.state.field(mappedVisualRecords), tr.state.doc, currentTheme());
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// These strings come only from bundled Tabler components, never book content.
const trash = renderToStaticMarkup(createElement(IconTrash, { size: 14, 'aria-hidden': true }));
const pencil = renderToStaticMarkup(createElement(IconPencil, { size: 18, 'aria-hidden': true }));
const bolt = renderToStaticMarkup(createElement(IconBolt, { size: 18, 'aria-hidden': true }));

class RecordGutterMarker extends GutterMarker {
  constructor(readonly records: RecordView[], readonly theme: ThemeName) { super(); }
  eq(other: RecordGutterMarker): boolean {
    return this.theme === other.theme && this.records.length === other.records.length &&
      this.records.every((record, index) => {
        const next = other.records[index]!;
        return record.id === next.id && record.kind === next.kind &&
          record.before === next.before && record.after === next.after && record.signalType === next.signalType;
      });
  }
  toDOM(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'gd-gutter-records';
    for (const record of this.records) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gd-record-marker';
      button.dataset.recordId = record.id;
      button.dataset.recordPos = String(record.from);
      const deletion = record.kind === 'edit' && record.after === '';
      button.setAttribute('aria-label', record.kind === 'signal' ? 'Сигнал' : deletion ? `Удаление: ${record.before}` : 'Правка');
      button.style.color = record.kind === 'signal' ? signalColor(record.signalType ?? 'note', this.theme) :
        deletion ? deletionColor(this.theme) : EDIT_MARKER_COLOR;
      button.innerHTML = record.kind === 'signal' ? bolt : pencil;
      group.appendChild(button);
    }
    return group;
  }
}

/** Gutter blocks follow CM's layout; each button also follows its wrapped visual row. */
const gutterGeometry = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) { this.measure(); }
  update() { this.measure(); }
  measure(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const rows = new Map<string, number>();
        // Resolve positions from this state, so stable DOM survives shifted anchors.
        const records = new Map(view.state.field(mappedVisualRecords).map(record => [record.id, record]));
        return [...view.dom.querySelectorAll<HTMLElement>('.gd-gutter-records .gd-record-marker')].map((button) => {
          const pos = records.get(button.dataset.recordId!)?.from;
          if (pos === null || pos === undefined) return { button, pos: null, top: 0, column: 0 };
          const coords = view.coordsAtPos(pos);
          const block = button.parentElement!.parentElement!.getBoundingClientRect();
          const top = coords === null ? 0 : coords.top - block.top;
          const row = String(Math.round(coords?.top ?? block.top));
          const column = rows.get(row) ?? 0;
          rows.set(row, column + 1);
          return { button, pos, top, column };
        });
      },
      write: (positions, view) => {
        let columns = 1;
        for (const { button, pos, top, column } of positions) {
          if (pos !== null) button.dataset.recordPos = String(pos);
          button.style.top = `${top}px`;
          button.style.left = `${column * 24}px`;
          columns = Math.max(columns, column + 1);
        }
        const dom = view.dom.querySelector<HTMLElement>('.gd-review-gutter');
        if (dom) {
          dom.style.width = `${columns * 24 + 8}px`;
          // CM hides decorative gutters by default; ours contains real controls.
          dom.parentElement?.removeAttribute('aria-hidden');
        }
      },
    });
  }
});

// Each state has one sorted index, shared by all visible gutter lines.
const gutterIndex = new WeakMap<RecordView[], RecordView[]>();
export function recordsForGutterLine(records: RecordView[], from: number, to: number): RecordView[] {
  let sorted = gutterIndex.get(records);
  if (!sorted) {
    sorted = records.filter(record => record.from !== null).sort((a, b) =>
      a.from! - b.from! || a.to! - b.to! || a.id.localeCompare(b.id));
    gutterIndex.set(records, sorted);
  }
  let low = 0, high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]!.from! < from) low = middle + 1;
    else high = middle;
  }
  let end = low;
  while (end < sorted.length && sorted[end]!.from! <= to) end++;
  return sorted.slice(low, end);
}

/** CM6 extensions appended after Galley internals. */
export function recordMarkers(): Extension {
  return [mappedRecords, mappedVisualRecords, recordMarkersField, gutter({
    class: 'gd-review-gutter',
    lineMarker: (view, line) => {
      const records = recordsForGutterLine(view.state.field(mappedVisualRecords), line.from, line.to);
      return records.length ? new RecordGutterMarker(records, currentTheme()) : null;
    },
    lineMarkerChange: (update) => update.startState.field(mappedVisualRecords) !== update.state.field(mappedVisualRecords),
  }), gutterGeometry];
}

export function dispatchRecordMarkers(view: EditorView, records: RecordView[]): void {
  view.dispatch({ effects: setRecordMarkers.of(records) });
}
