import { StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, showTooltip } from '@codemirror/view';
import type { Tooltip } from '@codemirror/view';
import type { RecordView } from '../../shared/api';
import { mappedRecords, setRecordMarkers } from './markers';

const previewTarget = StateEffect.define<string | null>();
const editorFocus = StateEffect.define<boolean>();
type PreviewState = { focused: boolean; tooltip: Tooltip | null };

/** The same passive before view serves caret, hover and keyboard gutter focus. */
function beforeTooltip(record: RecordView, pos: number): Tooltip {
  return {
    pos,
    above: true,
    create: () => {
      const dom = document.createElement('section');
      dom.className = 'gd-before-preview';
      dom.setAttribute('role', 'tooltip');
      dom.setAttribute('aria-label', 'До правки');
      const label = document.createElement('strong');
      label.textContent = 'До правки';
      const before = document.createElement('p');
      before.textContent = record.before || 'Добавление';
      dom.append(label, before);
      return { dom };
    },
  };
}

const previewField = StateField.define<PreviewState>({
  create: () => ({ focused: false, tooltip: null }),
  update(value, tr) {
    let focused = value.focused;
    let target: string | null | undefined;
    for (const effect of tr.effects) {
      if (effect.is(editorFocus)) focused = effect.value;
      if (effect.is(previewTarget)) target = effect.value;
    }
    const selection = tr.state.selection.main;
    if (!selection.empty || target === null) return { focused, tooltip: null };
    const records = tr.state.field(mappedRecords);
    if (target !== undefined) {
      const record = records.find((record) => record.id === target && record.kind === 'edit');
      return { focused, tooltip: record ? beforeTooltip(record, record.from!) : null };
    }
    const changed = tr.selection !== undefined || tr.docChanged || tr.effects.some((effect) =>
      effect.is(setRecordMarkers) || effect.is(editorFocus));
    if (!changed) return value;
    const record = focused ? records.find((record) => record.kind === 'edit' &&
      record.from! <= selection.head && selection.head <= record.to!) : undefined;
    return { focused, tooltip: record ? beforeTooltip(record, selection.head) : null };
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
    }
    destroyed = false;
    focus = (): void => {
      // Never dispatch inside native focus(): CM is restoring its DOM selection.
      queueMicrotask(() => {
        if (this.destroyed) return;
        const active = this.view.dom.ownerDocument.activeElement;
        const marker = active?.closest('.gd-record-marker');
        const effects: StateEffect<unknown>[] = [editorFocus.of(this.view.hasFocus)];
        if (marker && this.view.dom.contains(marker)) effects.push(previewTarget.of(marker.getAttribute('data-record-id')));
        else if (!this.view.hasFocus) effects.push(previewTarget.of(null));
        this.view.dispatch({ effects });
      });
    };
    over = (event: MouseEvent): void => {
      const marker = (event.target as Element).closest('[data-record-id]');
      if (marker && !marker.contains(event.relatedTarget as Node | null)) {
        this.view.dispatch({ effects: previewTarget.of(marker.getAttribute('data-record-id')) });
      }
    };
    out = (event: MouseEvent): void => {
      const marker = (event.target as Element).closest('[data-record-id]');
      if (marker && !marker.contains(event.relatedTarget as Node | null)) dismissRecordPreview(this.view);
    };
    destroy(): void {
      this.destroyed = true;
      this.view.dom.removeEventListener('focusin', this.focus);
      this.view.dom.removeEventListener('focusout', this.focus);
      this.view.dom.removeEventListener('mouseover', this.over);
      this.view.dom.removeEventListener('mouseout', this.out);
    }
  })];
}
