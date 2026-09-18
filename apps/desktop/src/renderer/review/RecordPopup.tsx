// Попап записи рецензии: одна и та же карточка открывается у якоря в редакторе
// (position задана), из списка навигации или в правой панели (position null).
// Правка — исходный/предложенный варианты и «Применить»/«Отклонить»; сигнал —
// комментарий и тип; недоступная/конфликтующая запись — сохранённые тексты,
// причина и удаление, без фиктивного перехода к якорю. Esc закрывает попап,
// не создавая сигнал, и возвращает фокус туда, где он был.
import { signalLabels, signalIcons } from './signal-types';
import { mappedVisualRecords } from '../editor/markers';
import { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import type { Command, RecordView } from '../../shared/api';
import { SIGNAL_TYPES, useMarkerTheme, signalColor } from '../editor/markers';
import type { SignalTypeName } from '../editor/markers';
import { Tooltip } from '../ui/Tooltip';

export type SignalDraft = { from: number; to: number; signalType: SignalTypeName };
export type PopupPosition = { x: number; y: number; bottom: number } | null;

type Props = {
  readOnly?: boolean;
  record?: RecordView | null;
  draft?: SignalDraft | null;
  at: PopupPosition;
  onCommand: (command: Command) => void;
  onClose: () => void;
};

/** Человекочитаемая причина недоступности (сам код сохраняется рядом). */
function reasonText(reason: string): string {
  if (reason.startsWith('conflicting')) return 'пересекается с другой правкой';
  if (reason.startsWith('stale')) return 'текст главы изменился';
  if (reason.startsWith('ambiguous')) return 'неоднозначное соответствие';
  return 'запись не найдена на текущем исходнике';
}

const cardBase: CSSProperties = {
  background: 'var(--app-panel)',
  color: 'var(--app-text)',
  border: 'none',
  borderRadius: 8,
  padding: '0.75rem',
  display: 'grid',
  gap: '0.5rem',
  textAlign: 'left',
  width: 440,
  maxWidth: 'min(100%, calc(100vw - 16px))',
  maxHeight: 'calc(100vh - 16px)',
  overflow: 'auto',
  overflowWrap: 'anywhere',
  boxSizing: 'border-box',
};

function floatingCard(at: NonNullable<PopupPosition>): CSSProperties {
  const top = Math.max(8, Math.min(at.bottom + 8, window.innerHeight - 360));
  return {
    ...cardBase,
    position: 'fixed',
    left: Math.max(8, Math.min(at.x, window.innerWidth - 448)),
    top,
    maxHeight: window.innerHeight - top - 8,
    zIndex: 40,
    boxShadow: 'var(--app-dialog-shadow)',
  };
}

const rowStyle: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' };

/** Restore both CM and native selection after the popup's textarea owned it. */
function focusEditor(content: HTMLElement): void {
  if (!content.isConnected) return;
  const view = EditorView.findFromDOM(content);
  if (view === null || !view.dom.isConnected) return;
  const selection = view.state.selection.main;
  view.focus();
  // CM focus can see its cached pre-popup DOM range and skip rewriting it,
  // although textarea focus actually collapsed the browser selection. Restore
  // via public positions before selectionchange can adopt that stale DOM range.
  const anchor = view.domAtPos(selection.anchor);
  const head = view.domAtPos(selection.head);
  const native = content.ownerDocument.getSelection();
  if (native !== null && (native.anchorNode !== anchor.node || native.anchorOffset !== anchor.offset ||
      native.focusNode !== head.node || native.focusOffset !== head.offset)) {
    native.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
  }
}

export function RecordPopup({ record = null, draft = null, at, onCommand, onClose, readOnly = false }: Props) {
  const theme = useMarkerTheme();
  const [comment, setComment] = useState(draft !== null ? '' : record?.comment ?? '');
  const [signalType, setSignalType] = useState<SignalTypeName>(
    draft?.signalType ?? record?.signalType ?? 'note',
  );
  const popupRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (record?.kind !== 'edit' || at === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return popupRef.current?.contains(target) === true || target.closest('[data-record-id]')?.getAttribute('data-record-id') === record.id;
    };
    const down = (event: PointerEvent) => { if (!inside(event.target)) closeRef.current(); };
    const over = (event: PointerEvent) => {
      clearTimeout(timer);
      if (!inside(event.target)) timer = setTimeout(() => closeRef.current(), 220);
    };
    const out = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        clearTimeout(timer);
        timer = setTimeout(() => closeRef.current(), 220);
      }
    };
    const selection = () => {
      const content = document.activeElement;
      if (!(content instanceof HTMLElement) || !content.matches('.cm-content')) return;
      const view = EditorView.findFromDOM(content);
      const range = view?.state.field(mappedVisualRecords, false)?.find((candidate) => candidate.id === record.id);
      const head = view?.state.selection.main.head;
      if (range !== undefined && head !== undefined && range.from !== null && range.to !== null &&
          (head < range.from || head > range.to)) closeRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('selectionchange', selection);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('selectionchange', selection);
    };
  }, [record, at]);
  // Восстановление фокуса при любом способе закрытия (Esc, действие, исчезновение
  // записи). Если фокус уже занят (открылся новый попап), его не перехватываем.
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const active = document.activeElement;
      if (!(active === null || active === document.body)) return;
      const restore = restoreRef.current;
      if (restore !== null && restore.isConnected) {
        if (restore.matches('.cm-content')) focusEditor(restore);
        else restore.focus();
      } else {
        const content = document.querySelector<HTMLElement>('.cm-content');
        // Native contenteditable.focus() can move the browser selection to
        // offset zero. CodeMirror.focus() restores its saved editor selection
        // while suppressing that intermediate DOM selection observation.
        if (content !== null) focusEditor(content);
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const saveDraft = (): void => {
    if (readOnly) return;
    if (draft !== null) {
      onCommand({ type: 'signal', from: draft.from, to: draft.to, signalType, comment });
      // Черновик отправлен: попап закрывается, повторное сохранение невозможно.
      onClose();
    }
  };
  const saveSignal = (): void => {
    if (readOnly) return;
    if (
      record !== null &&
      record.kind === 'signal' &&
      record.status === 'active' &&
      record.from !== null &&
      record.to !== null
    ) {
      onCommand({ type: 'signal', id: record.id, from: record.from, to: record.to, signalType, comment });
    }
  };
  const remove = (event: MouseEvent<HTMLButtonElement>): void => {
    if (record !== null) onCommand({ type: 'remove', id: record.id });
    event.currentTarget.blur();
  };

  if (draft !== null) {
    return (
      <div ref={popupRef} className="gd-record-popup" role="dialog" aria-label="Новый сигнал" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
        <strong>
          Новый сигнал: <span style={{ color: signalColor(draft.signalType, theme) }}>{signalLabels[signalType]}</span>
        </strong>
        <textarea
          readOnly={readOnly}
          autoFocus
          aria-label="Комментарий сигнала"
          rows={6}
          placeholder="Комментарий (необязательно)"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveDraft();
          }}
        />
        <div style={rowStyle}>
          <button type="button" disabled={readOnly} onClick={saveDraft}>
            Сохранить
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    );
  }
  if (record === null) return null;

  if (record.status !== 'active') {
    // Недоступная/конфликтующая запись: сохранённые тексты, причина, удаление.
    return (
      <div ref={popupRef} className="gd-record-popup" role="dialog" aria-label="Недоступная запись" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
        <strong>{record.kind === 'edit' ? 'Правка' : 'Сигнал'} — {record.status === 'conflicting' ? 'конфликтует' : 'недоступна'}</strong>
        {record.kind === 'edit' ? (
          <span>
            <s>{record.before}</s> → <strong>{record.after}</strong>
          </span>
        ) : (
          <span>
            <span style={{ color: signalColor(record.signalType ?? 'note', theme) }}>[{record.signalType ?? 'note'}]</span>
            {record.comment !== '' ? ` ${record.comment}` : ''}
          </span>
        )}
        <span>Причина: {reasonText(record.reason)} ({record.reason})</span>
        <div style={rowStyle}>
          <button type="button" disabled={readOnly} onClick={remove}>
            Удалить
          </button>
        </div>
      </div>
    );
  }

  if (record.kind === 'edit') {
    return (
      <div ref={popupRef} className="gd-record-popup" role="dialog" aria-label="Правка" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
        <strong>Правка</strong>
        <span>
          <s>{record.before}</s> → <strong>{record.after}</strong>
        </span>
        <div style={rowStyle}>
          <button
            type="button"
            aria-label="Применить"
            disabled={readOnly || record.status !== 'active'}
            onClick={() => void onCommand({ type: 'apply', id: record.id })}
          >
            Применить
          </button>
          <button type="button" disabled={readOnly} onClick={remove}>
            Отклонить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={popupRef} className="gd-record-popup" role="dialog" aria-label="Сигнал" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
      <strong>
        Сигнал: <span style={{ color: signalColor(signalType, theme) }}>{signalLabels[signalType]}</span>
      </strong>
      <div style={rowStyle}>
        {SIGNAL_TYPES.map((type) => (
          <Tooltip key={type} content={signalLabels[type]} describe={false}>
            <button
              aria-label={signalLabels[type]}
              type="button"
              disabled={readOnly}
              aria-pressed={signalType === type}
              style={{
                color: signalColor(type, theme),
                borderColor: signalColor(type, theme),
                background: signalType === type ? `color-mix(in srgb, ${signalColor(type, theme)} 15%, transparent)` : 'transparent',
                borderRadius: 6,
                cursor: 'pointer',
                padding: '0.1rem 0.4rem',
              }}
              onClick={() => setSignalType(type)}
            >
              {(() => { const Icon = signalIcons[type]; return <Icon size={20} aria-hidden="true" />; })()}
            </button>
          </Tooltip>
        ))}
      </div>
      <textarea
        readOnly={readOnly}
        aria-label="Комментарий сигнала"
        rows={6}
        placeholder="Комментарий (необязательно)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveSignal();
        }}
      />
      <div style={rowStyle}>
        <button type="button" disabled={readOnly} onClick={saveSignal}>
          Сохранить
        </button>
        <button type="button" onClick={onClose}>Отмена</button>
        <button type="button" disabled={readOnly} onClick={remove}>
          Удалить
        </button>
      </div>
    </div>
  );
}
