import { FONT_SIZE_BOUNDS, LINE_WIDTH_BOUNDS, themeOptions } from './appearance';
import { useAppearance } from './AppearanceProvider';

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function AppearancePanel() {
  const { appearance, setAppearance } = useAppearance();

  return (
    <section aria-label="Оформление" className="grid max-w-md gap-2 rounded-2xl bg-app-panel p-3">
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
  );
}
