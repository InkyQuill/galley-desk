// Flyout выбора типа сигнала у выделенного текста. Появляется без переноса
// фокуса: копирование и клавиатурная навигация в редакторе остаются доступны;
// в flyout можно попасть Tab-ом из редактора, пока выделение непусто.
import { signalLabels, signalIcons, signalHelp } from './signal-types';
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
      className="review-flyout"
      // Inline остаётся только живая позиция из геометрии выделения;
      // презентация панели и кнопок — в app.css (.review-flyout*).
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 320)),
        top: Math.min(bottom + 6, window.innerHeight - 48),
      }}
    >
      {SIGNAL_TYPES.map((type) => (
        <Tooltip key={type} content={signalHelp[type]} describe={type === 'good' || type === 'brilliant'}>
          <button
            aria-label={signalLabels[type]}
            type="button"
            className="review-flyout__action"
            // preventDefault на mousedown сохраняет выделение и фокус редактора.
            onMouseDown={(event) => event.preventDefault()}
            // Цвет пары — данные сигнала (ReviewColors); фон и hover-отклик
            // живут в CSS: inline background глушит общее hover-правило.
            style={{ color: signalColor(type, theme), borderColor: signalColor(type, theme) }}
            onClick={() => onPick(type)}
          >
            {(() => { const Icon = signalIcons[type]; return <Icon size={20} aria-hidden="true" />; })()}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
