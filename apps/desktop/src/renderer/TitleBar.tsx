import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconCopy, IconInfoCircle, IconMinus, IconSquare, IconX } from '@tabler/icons-react';
import type { WindowAction, WindowState } from '../shared/api';
import { Diagnostics } from './diagnostics/Diagnostics';
import { Tooltip } from './ui/Tooltip';

const iconUrl = new URL('../../assets/branding/galley-desk-icon.svg', import.meta.url).href;

// App mounts the titlebar for the welcome screen; BookWindow mounts it for an
// open book so book controls can stay with book state without a portal.
// Hosting Diagnostics here keeps the real panel reachable from both owners.
// It also answers the main-process app menu's "Диагностика" item (macOS,
// see main.ts) via onOpenDiagnosticsRequest.
export type TitleBarProps = { title: string; children?: ReactNode };

export function TitleBar({ title, children }: TitleBarProps) {
  const [state, setState] = useState<WindowState | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const diagnosticsButtonRef = useRef<HTMLButtonElement>(null);
  const diagnosticsReturnFocusRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    void window.desk.windowState().then(value => { if (active) setState(value); }).catch(() => undefined);
    const unsubscribe = window.desk.onWindowState(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => window.desk.onOpenDiagnosticsRequest(() => {
    diagnosticsReturnFocusRef.current = null;
    setDiagnosticsOpen(true);
  }), []);

  useEffect(() => {
    const open = (event: Event): void => {
      diagnosticsReturnFocusRef.current = (event as CustomEvent<{ returnFocus?: () => void }>).detail?.returnFocus ?? null;
      setDiagnosticsOpen(true);
    };
    window.addEventListener('galley-desk:open-diagnostics', open);
    return () => window.removeEventListener('galley-desk:open-diagnostics', open);
  }, []);

  // Escape/close explicitly returns focus to the button that opened the
  // panel -- the same manual-refocus convention BookWindow.tsx already uses
  // for its own dialogs (e.g. menuButtonRef after closing BookManagement),
  // rather than relying on the <dialog> element's own (unused) auto-restore.
  const closeDiagnostics = useCallback(() => {
    setDiagnosticsOpen(false);
    const returnFocus = diagnosticsReturnFocusRef.current;
    diagnosticsReturnFocusRef.current = null;
    requestAnimationFrame(() => {
      if (returnFocus !== null) returnFocus();
      else diagnosticsButtonRef.current?.focus();
    });
  }, []);

  const act = (action: WindowAction): void => { void window.desk.windowAction(action).then(setState).catch(() => undefined); };
  const toggleOnDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    const noDrag = (event.target as Element).closest(
      '.titlebar__actions, .titlebar__diagnostics, .titlebar__controls, dialog, button, input, select, textarea, [contenteditable="true"]',
    );
    if (state !== null && state.platform !== 'darwin' && noDrag === null) act('toggle-maximize');
  };

  return (
    <header className={`titlebar${state?.platform === 'darwin' ? ' titlebar--mac' : ''}`} onDoubleClick={toggleOnDoubleClick}>
      <img className="titlebar__icon" src={iconUrl} alt="Galley Desk" />
      <span className="titlebar__title">{title}</span>
      {children !== undefined && <div className="titlebar__actions">{children}</div>}
      <Tooltip content="Диагностика">
        <button
          type="button"
          ref={diagnosticsButtonRef}
          className={`titlebar__diagnostics${children !== undefined ? ' titlebar__diagnostics--book' : ''}`}
          aria-label="Диагностика"
          aria-haspopup="dialog"
          aria-expanded={diagnosticsOpen}
          onClick={() => { diagnosticsReturnFocusRef.current = null; setDiagnosticsOpen(true); }}
        >
          <IconInfoCircle />
        </button>
      </Tooltip>
      {state !== null && state.platform !== 'darwin' && (
        <div className="titlebar__controls">
          <Tooltip content="Свернуть окно"><button type="button" aria-label="Свернуть окно" onClick={() => act('minimize')}><IconMinus /></button></Tooltip>
          <Tooltip content={state.maximized ? 'Восстановить окно' : 'Развернуть окно'}><button type="button" aria-label={state?.maximized ? 'Восстановить окно' : 'Развернуть окно'} onClick={() => act('toggle-maximize')}>
            {state?.maximized ? <IconCopy /> : <IconSquare />}
          </button></Tooltip>
          <Tooltip content="Закрыть окно"><button type="button" className="titlebar__close" aria-label="Закрыть окно" onClick={() => act('close')}><IconX /></button></Tooltip>
        </div>
      )}
      {diagnosticsOpen && <Diagnostics onClose={closeDiagnostics} />}
    </header>
  );
}
