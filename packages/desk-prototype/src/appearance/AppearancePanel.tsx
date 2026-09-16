import { useDismissOnOutsideClick } from '../hooks/useDismissOnOutsideClick';
import { IconX } from '../icons';
import { FONT_SIZE_BOUNDS, LINE_WIDTH_BOUNDS, themeOptions } from './appearance';
import { useAppearance } from './AppearanceProvider';

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

type Props = {
  onClose: () => void;
};

/**
 * Пять настроек — не набирается на отдельную страницу, поэтому это попап
 * поверх контента (с подложкой), а не полноэкранный вид.
 */
export function AppearancePanel({ onClose }: Props) {
  const { appearance, setAppearance } = useAppearance();
  const ref = useDismissOnOutsideClick<HTMLDivElement>(onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-24"
      style={{ backgroundColor: 'var(--app-backdrop)' }}
    >
      <section
        ref={ref}
        aria-label="Оформление"
        className="grid w-[520px] gap-3 rounded-2xl bg-app-panel p-4 shadow-[var(--app-card-shadow)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Оформление</h2>
          <button type="button" title="Закрыть" aria-label="Закрыть" onClick={onClose} className="rounded-lg p-1 hover:bg-app-panel-muted">
            <IconX size={15} />
          </button>
        </div>
        <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
          Тема
          <select
            value={appearance.themeId}
            onChange={(event) => setAppearance({ ...appearance, themeId: event.target.value })}
            className="rounded-lg bg-app-panel-muted px-2 py-1"
          >
            {themeOptions().map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
          Шрифт интерфейса
          <input
            type="text"
            value={appearance.uiFontFamily}
            onChange={(event) => setAppearance({ ...appearance, uiFontFamily: event.target.value })}
            className="rounded-lg bg-app-panel-muted px-2 py-1"
          />
        </label>
        <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
          Шрифт книги
          <input
            type="text"
            value={appearance.bookFontFamily}
            onChange={(event) => setAppearance({ ...appearance, bookFontFamily: event.target.value })}
            className="rounded-lg bg-app-panel-muted px-2 py-1"
          />
        </label>
        <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
          {`Размер шрифта (${FONT_SIZE_BOUNDS.min}–${FONT_SIZE_BOUNDS.max})`}
          <input
            type="number"
            min={FONT_SIZE_BOUNDS.min}
            max={FONT_SIZE_BOUNDS.max}
            value={appearance.fontSize}
            onChange={(event) => setAppearance({ ...appearance, fontSize: clamp(Number(event.target.value), FONT_SIZE_BOUNDS) })}
            className="rounded-lg bg-app-panel-muted px-2 py-1"
          />
        </label>
        <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
          {`Ширина строки (${LINE_WIDTH_BOUNDS.min}–${LINE_WIDTH_BOUNDS.max})`}
          <input
            type="number"
            min={LINE_WIDTH_BOUNDS.min}
            max={LINE_WIDTH_BOUNDS.max}
            value={appearance.lineWidth}
            onChange={(event) => setAppearance({ ...appearance, lineWidth: clamp(Number(event.target.value), LINE_WIDTH_BOUNDS) })}
            className="rounded-lg bg-app-panel-muted px-2 py-1"
          />
        </label>
      </section>
    </div>
  );
}
