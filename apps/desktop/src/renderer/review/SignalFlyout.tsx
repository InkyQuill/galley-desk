// Flyout выбора типа сигнала у выделенного текста. Появляется без переноса
// фокуса: копирование и клавиатурная навигация в редакторе остаются доступны;
// в flyout можно попасть Tab-ом из редактора, пока выделение непусто.
import { signalLabels, signalIcons } from './signal-types';
import { useLayoutEffect } from 'react';
import { SIGNAL_TYPES, useMarkerTheme, signalColor } from '../editor/markers';
import type { SignalTypeName } from '../editor/markers';
import { Tooltip } from '../ui/Tooltip';

type Props = {
  /** Viewport-координаты начала flyout (у конца выделения). */
  x: number;
  bottom: number;
  /** Выбор типа: открывает попап комментария (Command signal). */
  onPick: (type: SignalTypeName) => void;
  /** Регистрация фокуса-функции для Tab-пути из редактора; null при демонтаже. */
  registerFocus: (focus: (() => void) | null) => void;
};

export function SignalFlyout({ x, bottom, onPick, registerFocus }: Props) {
  const theme = useMarkerTheme();
  // Tab must work as soon as the visible toolbar is committed.
  useLayoutEffect(() => {
    registerFocus(() => {
      document.querySelector<HTMLElement>('[data-review-flyout] button')?.focus();
    });
    return () => registerFocus(null);
  }, [registerFocus]);
  return (
    <div
      data-review-flyout="true"
      role="toolbar"
      aria-label="Тип сигнала"
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(x, window.innerWidth - 320)),
        top: Math.min(bottom + 6, window.innerHeight - 48),
        zIndex: 35,
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 8,
        background: 'var(--app-panel)',
        color: 'var(--app-text)',
        border: 'none',
        boxShadow: 'var(--app-dialog-shadow)',
      }}
    >
      {SIGNAL_TYPES.map((type) => (
        <Tooltip key={type} content={signalLabels[type]}>
          <button
            aria-label={signalLabels[type]}
            type="button"
            // preventDefault на mousedown сохраняет выделение и фокус редактора.
            onMouseDown={(event) => event.preventDefault()}
            style={{
              color: signalColor(type, theme),
              borderColor: signalColor(type, theme),
              background: 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '0.15rem 0.5rem',
            }}
            onClick={() => onPick(type)}
          >
            {(() => { const Icon = signalIcons[type]; return <Icon size={20} aria-hidden="true" />; })()}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
