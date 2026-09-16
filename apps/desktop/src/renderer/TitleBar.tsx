import { useEffect, useState, type MouseEvent } from 'react';
import { IconCopy, IconMinus, IconSquare, IconX } from '@tabler/icons-react';
import type { WindowAction, WindowState } from '../shared/api';

const iconUrl = new URL('../../assets/branding/galley-desk-icon.svg', import.meta.url).href;

export function TitleBar({ title }: { title: string }) {
  const [state, setState] = useState<WindowState | null>(null);

  useEffect(() => {
    let active = true;
    void window.desk.windowState().then(value => { if (active) setState(value); }).catch(() => undefined);
    const unsubscribe = window.desk.onWindowState(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const act = (action: WindowAction): void => { void window.desk.windowAction(action).then(setState).catch(() => undefined); };
  const toggleOnDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if (state !== null && state.platform !== 'darwin' && !(event.target as Element).closest('button')) act('toggle-maximize');
  };

  return (
    <header className={`titlebar${state?.platform === 'darwin' ? ' titlebar--mac' : ''}`} onDoubleClick={toggleOnDoubleClick}>
      <img className="titlebar__icon" src={iconUrl} alt="Galley Desk" />
      <span className="titlebar__title">{title}</span>
      {state !== null && state.platform !== 'darwin' && (
        <div className="titlebar__controls">
          <button type="button" aria-label="Свернуть окно" onClick={() => act('minimize')}><IconMinus /></button>
          <button type="button" aria-label={state?.maximized ? 'Восстановить окно' : 'Развернуть окно'} onClick={() => act('toggle-maximize')}>
            {state?.maximized ? <IconCopy /> : <IconSquare />}
          </button>
          <button type="button" className="titlebar__close" aria-label="Закрыть окно" onClick={() => act('close')}><IconX /></button>
        </div>
      )}
    </header>
  );
}
