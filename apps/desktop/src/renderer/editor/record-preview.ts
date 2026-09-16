import { StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, showTooltip } from '@codemirror/view';
import type { Tooltip } from '@codemirror/view';
import type { RecordView } from '../../shared/api';
import { visualRecord } from './visual-range';
import { currentTheme, signalColor, mappedRecords, setRecordMarkers } from './markers';

const previewTarget = StateEffect.define<string | null>();
const editorFocus = StateEffect.define<boolean>();
const previewIntent = StateEffect.define<null>();
export const setRecordPreviewBlocked = StateEffect.define<boolean>();
type PreviewState = { focused: boolean; blocked: boolean; dismissed: boolean; tooltip: Tooltip | null };

/** The same passive before view serves caret, hover and keyboard gutter focus. */
function beforeTooltip(record: RecordView, pos: number): Tooltip {
  return {
    pos,
    above: true,
    create: (view) => {
      const dom = document.createElement('section');
      dom.className = 'gd-before-preview';
      if (record.kind === 'signal') dom.style.color = signalColor(record.signalType ?? 'note', currentTheme());
      dom.setAttribute('role', 'tooltip');
      dom.setAttribute('aria-label', record.kind === 'signal' ? 'Комментарий сигнала' : 'До правки');
      dom.addEventListener('mouseleave', () => dismissRecordPreview(view));
      const label = document.createElement('strong');
      label.textContent = record.kind === 'signal' ? 'Сигнал' : 'До правки';
      const before = document.createElement('p');
      before.textContent = record.kind === 'signal' ? record.comment || record.before : record.before || 'Добавление';
      dom.append(label, before);
      return { dom };
    },
  };
}

const previewField = StateField.define<PreviewState>({
  create: () => ({ focused: false, blocked: false, dismissed: false, tooltip: null }),
  update(value, tr) {
    let { focused, blocked, dismissed } = value;
    if (tr.isUserEvent('select') || tr.isUserEvent('input')) dismissed = false;
    let target: string | null | undefined;
    for (const effect of tr.effects) {
      if (effect.is(editorFocus)) focused = effect.value;
      if (effect.is(previewIntent)) dismissed = false;
      if (effect.is(setRecordPreviewBlocked)) {
        blocked = effect.value;
        // Closing the action dialog must not resurrect its preview on focus restore.
        dismissed = true;
      }
      if (effect.is(previewTarget)) target = effect.value;
    }
    const selection = tr.state.selection.main;
    if (target === null) dismissed = true;
    if (blocked || dismissed || !selection.empty) return { focused, blocked, dismissed, tooltip: null };
    const records = tr.state.field(mappedRecords).map(visualRecord);
    if (target !== undefined) {
      const record = records.find((record) => record.id === target);
      return { focused, blocked, dismissed, tooltip: record ? beforeTooltip(record, record.from!) : null };
    }
    const changed = tr.selection !== undefined || tr.docChanged || tr.effects.some((effect) =>
      effect.is(setRecordMarkers) || effect.is(editorFocus) || effect.is(previewIntent));
    if (!changed) return value;
    const record = focused ? records.find((record) => record.kind === 'edit' &&
      record.from! <= selection.head && (selection.head < record.to! || record.from === record.to && selection.head === record.from)) : undefined;
    return { focused, blocked, dismissed, tooltip: record ? beforeTooltip(record, selection.head) : null };
  },
  provide: (field) => showTooltip.from(field, (value) => value.tooltip),
});

export function dismissRecordPreview(view: EditorView): boolean {
  if (view.state.field(previewField).tooltip === null) return false;
  view.dispatch({ effects: previewTarget.of(null) });
  return true;
}

export function recordPreview(): Extension {
  return [previewField, EditorView.domEventHandlers({
    mousedown: (_event, view) => { dismissRecordPreview(view); },
    scroll: (_event, view) => { dismissRecordPreview(view); },
  }), ViewPlugin.fromClass(class {
    constructor(readonly view: EditorView) {
      view.dom.addEventListener('focusin', this.focus);
      view.dom.addEventListener('focusout', this.focus);
      view.dom.addEventListener('mouseover', this.over);
      view.dom.addEventListener('mouseout', this.out);
      view.dom.ownerDocument.addEventListener('keydown', this.keydown, true);
      view.dom.ownerDocument.addEventListener('focusin', this.outsideFocus, true);
    }
    destroyed = false;
    tabFocusIntent = false;
    keydown = (event: KeyboardEvent): void => {
      this.tabFocusIntent = event.key === 'Tab';
    };
    outsideFocus = (event: FocusEvent): void => {
      if (!this.view.dom.contains(event.target as Node)) this.tabFocusIntent = false;
    };
    focus = (): void => {
      // Never dispatch inside native focus(): CM is restoring its DOM selection.
      queueMicrotask(() => {
        if (this.destroyed) return;
        const active = this.view.dom.ownerDocument.activeElement;
        const marker = active?.closest('.gd-record-marker');
        const effects: StateEffect<unknown>[] = [editorFocus.of(this.view.hasFocus)];
        if (this.tabFocusIntent && active !== null && this.view.dom.contains(active)) effects.push(previewIntent.of(null));
        this.tabFocusIntent = false;
        if (marker && this.view.dom.contains(marker)) effects.push(previewTarget.of(marker.getAttribute('data-record-id')));
        else if (!this.view.hasFocus) effects.push(previewTarget.of(null));
        this.view.dispatch({ effects });
      });
    };
    over = (event: MouseEvent): void => {
      const marker = (event.target as Element).closest('[data-record-id]');
      if (marker && !marker.contains(event.relatedTarget as Node | null)) {
        this.view.dispatch({ effects: [previewIntent.of(null), previewTarget.of(marker.getAttribute('data-record-id'))] });
      }
    };
    out = (event: MouseEvent): void => {
      const marker = (event.target as Element).closest('[data-record-id]');
      const tooltip = (event.target as Element).closest('.gd-before-preview');
      if (tooltip && !tooltip.contains(event.relatedTarget as Node | null) ||
          marker && !marker.contains(event.relatedTarget as Node | null) &&
          !(event.relatedTarget instanceof Element && event.relatedTarget.closest('.gd-before-preview'))) dismissRecordPreview(this.view);
    };
    destroy(): void {
      this.destroyed = true;
      this.view.dom.removeEventListener('focusin', this.focus);
      this.view.dom.removeEventListener('focusout', this.focus);
      this.view.dom.removeEventListener('mouseover', this.over);
      this.view.dom.removeEventListener('mouseout', this.out);
      this.view.dom.ownerDocument.removeEventListener('keydown', this.keydown, true);
      this.view.dom.ownerDocument.removeEventListener('focusin', this.outsideFocus, true);
    }
  })];
}
