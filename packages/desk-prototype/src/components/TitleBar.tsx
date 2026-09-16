import { useState } from 'react';
import { IconMenu2, IconMinus, IconSquare, IconX } from '../icons';

const MENU_ITEMS = ['Файл', 'Правка', 'Вид', 'Справка'];

/**
 * Визуальный мок стилизованного заголовка окна и системного меню — не
 * настраивает реальный Electron BrowserWindow (frame/titleBarStyle), см.
 * спеку «Кастомный window frame и системное меню».
 */
export function TitleBar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-app-text-muted">
      <img src="/galley-desk-icon.svg" alt="Galley Desk" className="h-4 w-4" />
      <div className="relative">
        <button
          type="button"
          title="Меню"
          aria-label="Меню"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={`rounded-lg p-1 hover:bg-app-hover ${menuOpen ? 'bg-app-hover' : ''}`}
        >
          <IconMenu2 size={14} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-8 z-20 w-40 rounded-xl bg-app-panel p-1 shadow-[var(--app-card-shadow)]">
            {MENU_ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMenuOpen(false)}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-panel-muted"
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as never} />
      <div className="flex gap-1">
        <button type="button" title="Свернуть" aria-label="Свернуть" onClick={() => undefined} className="rounded-lg p-1 hover:bg-app-hover">
          <IconMinus size={14} />
        </button>
        <button type="button" title="Развернуть" aria-label="Развернуть" onClick={() => undefined} className="rounded-lg p-1 hover:bg-app-hover">
          <IconSquare size={12} />
        </button>
        <button type="button" title="Закрыть" aria-label="Закрыть" onClick={() => undefined} className="rounded-lg p-1 hover:bg-app-error hover:text-app-bg">
          <IconX size={14} />
        </button>
      </div>
    </div>
  );
}
