// Общая тем-подсказка приложения (история №7 UX-ревью, Task 10). Два способа
// подключения делят один controller и один host, поэтому в приложении ровно
// одна визуальная система подсказок:
//  - Tooltip -- React-обёртка одного trigger'а (кнопки и т.п.);
//  - attachTooltip (renderer/ui/tooltip-controller.ts) -- императивные
//    DOM-виджеты редактора (CodeMirror не React-дерево).
// TooltipHost рендерится один раз внутри .app-root (см. App.tsx), поэтому
// наследует переменные темы и UI-шрифта контейнера, а не отдельный детач-портал.
import { cloneElement, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { bindTooltip, getTooltipSnapshot, subscribeTooltip, TOOLTIP_ID } from './tooltip-controller';

export type TooltipProps = {
  content: ReactNode;
  /** Отдельная строка сочетания клавиш (например, Zen: Ctrl+Alt+Z / Cmd+Alt+Z). */
  shortcut?: string;
  children: ReactElement;
};

type RefValue = HTMLElement | null;
type RefLike = Ref<RefValue> | undefined;

function assignRef(ref: RefLike, node: RefValue): void {
  if (typeof ref === 'function') ref(node);
  else if (ref !== null && ref !== undefined && typeof ref === 'object') (ref as { current: RefValue }).current = node;
}

/**
 * Единственный trigger -- children клонируется только с новым ref (свой +
 * исходный). Остальные пропсы (обработчики, aria-*, disabled и т.д.) не
 * трогаются: подсказка вешает СВОИ DOM-слушатели через bindTooltip
 * (addEventListener), а не React onMouseEnter/onFocus, поэтому ничего не
 * перезаписывается и лишней кнопки/span-обёртки (лишнего tab stop) не появляется.
 */
export function Tooltip({ content, shortcut, children }: TooltipProps) {
  const contentRef = useRef(content);
  contentRef.current = content;
  const shortcutRef = useRef(shortcut);
  shortcutRef.current = shortcut;

  const originalRefRef = useRef<RefLike>(undefined);
  originalRefRef.current = (children.props as { ref?: RefLike }).ref;

  const cleanupRef = useRef<(() => void) | null>(null);

  // Стабильный callback: переустанавливается только при реальной смене DOM-узла
  // (монтирование/размонтирование), а не при каждом ререндере -- иначе видимая
  // подсказка гасла бы при любом несвязанном обновлении родителя.
  const mergedRef = useCallback((node: RefValue) => {
    cleanupRef.current?.();
    cleanupRef.current = node ? bindTooltip(node, () => contentRef.current, () => shortcutRef.current) : null;
    assignRef(originalRefRef.current, node);
  }, []);

  return cloneElement(children, { ref: mergedRef } as { ref: typeof mergedRef });
}

const HIDDEN_STYLE: CSSProperties = { position: 'fixed', top: 0, left: 0, opacity: 0 };

/**
 * Единственный themed host всех подсказок приложения (React и DOM-виджеты
 * редактора) -- монтируется один раз в App.tsx внутри .app-root, поэтому
 * получает переменные темы/UI-шрифта через обычный CSS-каскад, а не отдельный
 * detached-портал в document.body.
 */
export function TooltipHost() {
  const snapshot = useSyncExternalStore(subscribeTooltip, getTooltipSnapshot, getTooltipSnapshot);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_STYLE);

  // useLayoutEffect: подсказка сначала рендерится с уже актуальным содержимым
  // (чтобы её можно было измерить), а положение/видимость выставляются до
  // отрисовки кадра -- без видимого "прыжка" из угла экрана.
  useLayoutEffect(() => {
    if (!snapshot.visible || snapshot.rect === null || !nodeRef.current) {
      setStyle(HIDDEN_STYLE);
      return;
    }
    const margin = 8;
    const { width, height } = nodeRef.current.getBoundingClientRect();
    const rect = snapshot.rect;
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - margin) top = rect.top - height - 6;
    top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - height - margin));
    let left = rect.left;
    left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - width - margin));
    setStyle({ position: 'fixed', top, left, opacity: 1 });
    // snapshot.rect -- новый DOMRect на каждый показ, годится как зависимость.
  }, [snapshot.visible, snapshot.rect, snapshot.content, snapshot.shortcut]);

  return (
    <div ref={nodeRef} id={TOOLTIP_ID} role="tooltip" className="gd-tooltip" style={style} aria-hidden={!snapshot.visible}>
      {snapshot.visible && (
        <>
          <span className="gd-tooltip__text">{snapshot.content}</span>
          {snapshot.shortcut !== undefined && <span className="gd-tooltip__shortcut">{snapshot.shortcut}</span>}
        </>
      )}
    </div>
  );
}
