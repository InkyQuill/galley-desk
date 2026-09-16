// Попап записи рецензии: одна и та же карточка открывается у якоря в редакторе
// (position задана), из списка навигации или в правой панели (position null).
// Правка — исходный/предложенный варианты и «Применить»/«Отклонить»; сигнал —
// комментарий и тип; недоступная/конфликтующая запись — сохранённые тексты,
// причина и удаление, без фиктивного перехода к якорю. Esc закрывает попап,
// не создавая сигнал, и возвращает фокус туда, где он был.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import type { Command, RecordView } from '../../shared/api';
import { SIGNAL_TYPES, useMarkerTheme, signalColor } from '../editor/markers';
import type { SignalTypeName } from '../editor/markers';

export type SignalDraft = { from: number; to: number; signalType: SignalTypeName };
export type PopupPosition = { x: number; y: number; bottom: number } | null;

type Props = {
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
  background: 'Canvas',
  color: 'CanvasText',
  border: '1px solid color-mix(in srgb, CanvasText 30%, transparent)',
  borderRadius: 8,
  padding: '0.75rem',
  display: 'grid',
  gap: '0.5rem',
  textAlign: 'left',
  maxWidth: '20rem',
};

function floatingCard(at: NonNullable<PopupPosition>): CSSProperties {
  return {
    ...cardBase,
    position: 'fixed',
    left: Math.max(8, Math.min(at.x, window.innerWidth - 336)),
    top: Math.max(8, Math.min(at.bottom + 8, window.innerHeight - 220)),
    zIndex: 40,
    boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
  };
}

const rowStyle: CSSProperties = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' };

export function RecordPopup({ record = null, draft = null, at, onCommand, onClose }: Props) {
  const theme = useMarkerTheme();
  const [comment, setComment] = useState(draft !== null ? '' : record?.comment ?? '');
  const [signalType, setSignalType] = useState<SignalTypeName>(
    draft?.signalType ?? record?.signalType ?? 'note',
  );
  // Восстановление фокуса при любом способе закрытия (Esc, действие, исчезновение
  // записи). Если фокус уже занят (открылся новый попап), его не перехватываем.
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const active = document.activeElement;
      if (!(active === null || active === document.body)) return;
      const restore = restoreRef.current;
      if (restore !== null && restore.isConnected) restore.focus();
      else document.querySelector<HTMLElement>('.cm-content')?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  const saveDraft = (): void => {
    if (draft !== null) {
      onCommand({ type: 'signal', from: draft.from, to: draft.to, signalType, comment });
      // Черновик отправлен: попап закрывается, повторное сохранение невозможно.
      onClose();
    }
  };
  const saveSignal = (): void => {
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
      <div role="dialog" aria-label="Новый сигнал" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
        <strong>
          Новый сигнал: <span style={{ color: signalColor(draft.signalType, theme) }}>{draft.signalType}</span>
        </strong>
        <textarea
          autoFocus
          aria-label="Комментарий сигнала"
          rows={3}
          placeholder="Комментарий (необязательно)"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveDraft();
          }}
        />
        <div style={rowStyle}>
          <button type="button" onClick={saveDraft}>
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
      <div role="dialog" aria-label="Недоступная запись" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
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
          <button type="button" onClick={remove}>
            Удалить
          </button>
        </div>
      </div>
    );
  }

  if (record.kind === 'edit') {
    return (
      <div role="dialog" aria-label="Правка" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
        <strong>Правка</strong>
        <span>
          <s>{record.before}</s> → <strong>{record.after}</strong>
        </span>
        <div style={rowStyle}>
          <button
            type="button"
            aria-label="Применить"
            disabled={record.status !== 'active'}
            onClick={() => void onCommand({ type: 'apply', id: record.id })}
          >
            Применить
          </button>
          <button type="button" onClick={remove}>
            Отклонить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label="Сигнал" style={at !== null ? floatingCard(at) : cardBase} onKeyDown={onKeyDown}>
      <strong>
        Сигнал: <span style={{ color: signalColor(signalType, theme) }}>{signalType}</span>
      </strong>
      <div style={rowStyle}>
        {SIGNAL_TYPES.map((type) => (
          <button
            key={type}
            type="button"
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
            {type}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Комментарий сигнала"
        rows={3}
        placeholder="Комментарий (необязательно)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveSignal();
        }}
      />
      <div style={rowStyle}>
        <button type="button" onClick={saveSignal}>
          Сохранить
        </button>
        <button type="button" onClick={remove}>
          Удалить
        </button>
      </div>
    </div>
  );
}
