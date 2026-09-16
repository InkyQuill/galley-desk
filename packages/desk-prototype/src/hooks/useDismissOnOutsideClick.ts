import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Закрывает попап только при полном клике снаружи: и mousedown, и mouseup
 * должны попасть вне элемента. Если клик (например, выделение текста)
 * начался внутри попапа и палец/курсор отпущен снаружи — попап не закрывается.
 */
export function useDismissOnOutsideClick<T extends HTMLElement>(onDismiss: () => void): RefObject<T> {
  const ref = useRef<T>(null);
  const startedInsideRef = useRef(false);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      startedInsideRef.current = ref.current !== null && ref.current.contains(event.target as Node);
    };
    const handleMouseUp = (event: MouseEvent): void => {
      const endedInside = ref.current !== null && ref.current.contains(event.target as Node);
      if (!startedInsideRef.current && !endedInside) onDismiss();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onDismiss]);

  return ref;
}
