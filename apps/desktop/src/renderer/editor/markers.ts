// Marker decorations of review records over the derived text (pure function of
// RecordView[] + document). RecordView.from/to are UTF-16 positions of the SAME
// derived text as the editor document, so mapping is direct; between snapshots
// the built DecorationSet is mapped through ordinary document changes (the
// StateField below) and rebuilt fresh on every setRecordMarkers effect.
//
// Цвета типов сигналов повторяют ReviewColors из Pocket Editor (светлая и
// тёмная темы отдельно), источник —
// /home/inky/Development/pocket-editor/app/src/main/java/net/inkyquill/pocketeditor/ui/theme/Color.kt
// (LightReviewColors/DarkReviewColors; оттенки правок — Umber/Amber и
// deletion/additionContainer оттуда же). Рендерер не может импортировать
// Kotlin, поэтому значения захардкожены здесь.
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { Range, StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import type { RecordView } from '../../shared/api';

export const SIGNAL_TYPES = ['note', 'change_required', 'warning', 'review'] as const;
export type SignalTypeName = (typeof SIGNAL_TYPES)[number];
export type ThemeName = 'light' | 'dark';

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

/** Current renderer theme; appearance switching lands with the search task. */
export function currentTheme(): ThemeName {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// --- decorations -------------------------------------------------------------

/** Rebuilds the marker decorations from fresh RecordViews. */
export const setRecordMarkers = StateEffect.define<RecordView[]>();

const fade = (color: string): string => `color-mix(in srgb, ${color} 16%, transparent)`;

/**
 * Стили маркеров: значок карандаша/молнии рисуется ::before из data-icon,
 * поэтому сам виджет не добавляет символов в текст документа (innerText
 * остаётся чистым — копирование и тесты текста не видят значков).
 */
const MARKER_STYLES = `
.gd-record-marker::before { content: attr(data-icon); font-size: 0.9em; line-height: 1; }
`;

/** Однократная установка стилей маркеров (идемпотентно). */
export function installMarkerStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gd-marker-styles') !== null) return;
  const element = document.createElement('style');
  element.id = 'gd-marker-styles';
  element.textContent = MARKER_STYLES;
  document.head.appendChild(element);
}

class RecordMarkerWidget extends WidgetType {
  constructor(
    readonly record: RecordView,
    readonly theme: ThemeName,
  ) {
    super();
  }

  eq(other: RecordMarkerWidget): boolean {
    return (
      other.record.id === this.record.id &&
      other.theme === this.theme &&
      other.record.kind === this.record.kind &&
      other.record.status === this.record.status &&
      other.record.before === this.record.before &&
      other.record.after === this.record.after &&
      other.record.comment === this.record.comment &&
      other.record.signalType === this.record.signalType
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'gd-record-marker';
    span.setAttribute('data-record-id', this.record.id);
    // Роль кнопки даёт доступ по имени: «Правка»/«Сигнал» (клик открывает попап).
    span.setAttribute('role', 'button');
    span.contentEditable = 'false';
    span.style.cursor = 'pointer';
    span.style.padding = '0 1px';
    if (this.record.kind === 'edit') {
      span.setAttribute('data-icon', '✎');
      if (this.record.after === '') {
        // Удаление: видимый маркер, даже если текста в производном тексте нет.
        span.setAttribute('aria-label', `Удаление: ${this.record.before}`);
        span.title = `Удаление: ${this.record.before}`;
        span.style.color = deletionColor(this.theme);
      } else {
        span.setAttribute('aria-label', 'Правка');
        span.title = `Правка: ${this.record.before} → ${this.record.after}`;
      }
    } else {
      const type = this.record.signalType ?? 'note';
      span.setAttribute('data-icon', '⚡');
      span.setAttribute('aria-label', 'Сигнал');
      span.title = `Сигнал [${type}]${this.record.comment !== '' ? `: ${this.record.comment}` : ''}`;
      span.style.color = signalColor(type, this.theme);
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Комментарий сигнала: подстрока под привязанным диапазоном (block widget). */
class CommentWidget extends WidgetType {
  constructor(
    readonly record: RecordView,
    readonly theme: ThemeName,
  ) {
    super();
  }

  eq(other: CommentWidget): boolean {
    return (
      other.record.id === this.record.id &&
      other.record.comment === this.record.comment &&
      other.record.signalType === this.record.signalType &&
      other.theme === this.theme
    );
  }

  toDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'gd-signal-comment';
    div.setAttribute('data-record-id', this.record.id);
    div.setAttribute('contenteditable', 'false');
    div.style.color = signalColor(this.record.signalType ?? 'note', this.theme);
    div.style.opacity = '0.85';
    div.style.fontSize = '0.85em';
    div.style.padding = '0 0.35em';
    div.textContent = this.record.comment;
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Строит украшения по записям и документу: правка — карандаш и подложка
 * диапазона, сигнал — молния в цвете типа и подложка, комментарий — блок-виджет
 * под строкой диапазона, удаление — zero-width виджет с доступным названием.
 * Пересекающиеся сигналы получают независимые виджеты (по одному на запись).
 */
export function buildDecorations(records: RecordView[], doc: Text, theme: ThemeName = currentTheme()): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const length = doc.length;
  for (const record of records) {
    if (record.from === null || record.to === null) continue;
    const from = Math.max(0, Math.min(record.from, length));
    const to = Math.max(0, Math.min(record.to, length));
    if (from > to) continue;
    const marker = Decoration.widget({ widget: new RecordMarkerWidget(record, theme), side: 1 });
    if (record.kind === 'edit') {
      if (from < to) {
        ranges.push(marker.range(to));
        ranges.push(
          Decoration.mark({ class: 'gd-edit-range', attributes: { style: `background-color:${editRangeTint(theme)}` } }).range(from, to),
        );
      } else {
        // Удаление: нулевой диапазон — только видимый виджет.
        ranges.push(marker.range(from));
      }
    } else {
      const type = record.signalType ?? 'note';
      const color = signalColor(type, theme);
      if (from < to) {
        ranges.push(marker.range(to));
        ranges.push(
          Decoration.mark({
            class: `gd-signal-range gd-signal-range--${type}`,
            attributes: {
              style: `background-color:${fade(color)};text-decoration-line:underline;text-decoration-style:dotted;text-decoration-color:${color}`,
            },
          }).range(from, to),
        );
      } else {
        ranges.push(marker.range(from));
      }
      if (record.comment !== '') {
        // Блок-виджет строго на границе строки — «подстрока» под диапазоном.
        const lineEnd = doc.lineAt(to).to;
        ranges.push(Decoration.widget({ widget: new CommentWidget(record, theme), block: true, side: 1 }).range(lineEnd));
      }
    }
  }
  return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
}

const recordMarkersField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setRecordMarkers)) next = buildDecorations(effect.value, tr.state.doc);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** CM6 extension appended after Galley internals (GalleyEditorProps.extensions). */
export function recordMarkers(): Extension {
  return recordMarkersField;
}

/** Заменяет набор украшений по свежим записям (после ack снапшота). */
export function dispatchRecordMarkers(view: EditorView, records: RecordView[]): void {
  view.dispatch({ effects: setRecordMarkers.of(records) });
}
