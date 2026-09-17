import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { IconCopy, IconInfoCircle, IconMinus, IconSquare, IconX } from '@tabler/icons-react';
import type { WindowAction, WindowState } from '../shared/api';
import { Diagnostics } from './diagnostics/Diagnostics';

const iconUrl = new URL('../../assets/branding/galley-desk-icon.svg', import.meta.url).href;

// The titlebar is mounted once at App level and renders identically above
// both the welcome/recent-books screen and an open book (see App.tsx) --
// hosting the Diagnostics entry point here makes it reachable from both
// without duplicating it in RecentBooks.tsx and BookWindow.tsx separately.
// It also answers the main-process app menu's "Диагностика" item (macOS,
// see main.ts) via onOpenDiagnosticsRequest.
export function TitleBar({ title }: { title: string }) {
  const [state, setState] = useState<WindowState | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const diagnosticsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void window.desk.windowState().then(value => { if (active) setState(value); }).catch(() => undefined);
    const unsubscribe = window.desk.onWindowState(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => window.desk.onOpenDiagnosticsRequest(() => setDiagnosticsOpen(true)), []);

  // Escape/close explicitly returns focus to the button that opened the
  // panel -- the same manual-refocus convention BookWindow.tsx already uses
  // for its own dialogs (e.g. menuButtonRef after closing BookManagement),
  // rather than relying on the <dialog> element's own (unused) auto-restore.
  const closeDiagnostics = useCallback(() => {
    setDiagnosticsOpen(false);
    diagnosticsButtonRef.current?.focus();
  }, []);

  const act = (action: WindowAction): void => { void window.desk.windowAction(action).then(setState).catch(() => undefined); };
  const toggleOnDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if (state !== null && state.platform !== 'darwin' && !(event.target as Element).closest('button')) act('toggle-maximize');
  };

  return (
    <header className={`titlebar${state?.platform === 'darwin' ? ' titlebar--mac' : ''}`} onDoubleClick={toggleOnDoubleClick}>
      <img className="titlebar__icon" src={iconUrl} alt="Galley Desk" />
      <span className="titlebar__title">{title}</span>
      <button
        type="button"
        ref={diagnosticsButtonRef}
        className="titlebar__diagnostics"
        aria-label="Диагностика"
        title="Диагностика"
        aria-haspopup="dialog"
        aria-expanded={diagnosticsOpen}
        onClick={() => setDiagnosticsOpen(true)}
      >
        <IconInfoCircle />
      </button>
      {state !== null && state.platform !== 'darwin' && (
        <div className="titlebar__controls">
          <button type="button" aria-label="Свернуть окно" onClick={() => act('minimize')}><IconMinus /></button>
          <button type="button" aria-label={state?.maximized ? 'Восстановить окно' : 'Развернуть окно'} onClick={() => act('toggle-maximize')}>
            {state?.maximized ? <IconCopy /> : <IconSquare />}
          </button>
          <button type="button" className="titlebar__close" aria-label="Закрыть окно" onClick={() => act('close')}><IconX /></button>
        </div>
      )}
      {diagnosticsOpen && <Diagnostics onClose={closeDiagnostics} />}
    </header>
  );
}
