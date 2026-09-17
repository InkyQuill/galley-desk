import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Escape clipping ancestors while retaining App's theme and UI typography. */
export function AnchoredLayer({ anchor, children, className, align = 'left' }: {
  anchor: RefObject<HTMLElement | null>; children: ReactNode; className: string; align?: 'left' | 'right';
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 8, left: 8, opacity: 0 });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.current || !layer.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const width = layer.current.getBoundingClientRect().width;
      const top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - 120));
      const left = Math.max(8, Math.min(align === 'right' ? rect.right - width : rect.left, innerWidth - width - 8));
      setStyle({ position: 'fixed', left, top, maxHeight: innerHeight - top - 8, opacity: 1 });
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, align]);
  const root = document.querySelector('.app-root');
  return root && createPortal(<div ref={layer} className={className} style={style}>{children}</div>, root);
}
