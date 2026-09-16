// Панель «Оформление»: тема из каталога galley-themes, шрифт, размер шрифта
// и ширина строки. Значения хранятся в appData через DeskApi.setAppearance
// (main проверяет границы fontSize 10–48 и lineWidth 320–1600 и известный
// themeId) и никогда не меняют файлы книги. Чистые функции (resolveTheme,
// schemeOf, windowContainerStyle) доступны тестам и BookWindow: стиль
// применяется на контейнере окна, а схема темы уходит в маркеры (markers.ts).
import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  BUILT_IN_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getTheme,
  isThemeId,
  themeToCssVariables,
} from '@inkyquill/galley-themes';
import type { ThemeCssVariables, ThemeDefinition } from '@inkyquill/galley-themes';
import type { AppearanceSettings } from '../../shared/api';

/** Системная схема: светлая/тёмная тема каталога выбирается по ОС. */
export const SYSTEM_THEME_ID = 'auto';

/** Границы числовых настроек — зеркально main (settings.ts). */
export const FONT_SIZE_BOUNDS = { min: 10, max: 48 } as const;
export const LINE_WIDTH_BOUNDS = { min: 320, max: 1600 } as const;

/** Значения по умолчанию — зеркально main (settings.ts): сбой загрузки
 * настроек не оставляет приложение без оформления. */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeId: SYSTEM_THEME_ID,
  fontFamily: 'Literata',
  fontSize: 18,
  uiFontFamily: 'Geist',
  uiFontSize: 13,
  lineWidth: 700,
};

/** Идентификаторы тем для селекта: «auto» + весь встроенный каталог. */
export function themeOptions(): { id: string; label: string }[] {
  return [
    { id: SYSTEM_THEME_ID, label: 'Системная' },
    ...BUILT_IN_THEMES.map((theme) => ({ id: theme.id, label: theme.label })),
  ];
}

/**
 * Чистый резолв по уже известной системной схеме: «Системная» («auto») и
 * неизвестные идентификаторы дают базовую тему схемы, явные — саму тему.
 */
export function resolveThemeForScheme(themeId: string, systemDark: boolean): ThemeDefinition {
  if (isThemeId(themeId)) return getTheme(themeId)!;
  return getTheme(systemDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID)!;
}

/** Текущая системная схема (одиночный опрос matchMedia); без окна — светлая. */
export function systemSchemeDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Резолв идентификатора темы: неизвестный/«auto» → светлый или тёмный базовая. */
export function resolveTheme(themeId: string): ThemeDefinition {
  return resolveThemeForScheme(themeId, systemSchemeDark());
}

/**
 * Подписка на живую смену системной схемы («Системная» тема следует за ОС
 * без перезапуска). Возвращает функцию отписки; без окна подписки нет.
 */
export function subscribeSystemScheme(onChange: (dark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent): void => onChange(event.matches);
  // Стандартный addEventListener; старым движкам остаётся addListener.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  query.addListener(handler);
  return () => query.removeListener(handler);
}

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Стиль контейнера окна: переменные темы (включая colorScheme), поверхности
 * приложения и редактора, шрифт и его размер (в редактор — через переменные
 * Galley). Подложки маркеров при этом остаются Pocket-совместимыми константами.
 */
export function windowContainerStyle(
  theme: ThemeDefinition,
  appearance: AppearanceSettings,
): CSSProperties {
  const vars: ThemeCssVariables = themeToCssVariables(theme);
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key.startsWith('--')) custom[key] = value;
  }
  return {
    colorScheme: vars.colorScheme,
    backgroundColor: 'var(--app-bg)',
    color: 'var(--app-text)',
    fontFamily: `${appearance.uiFontFamily}, system-ui, sans-serif`,
    fontSize: `${appearance.uiFontSize}px`,
    ...custom,
    // Типографика редактора Galley управляется переменными, наследование
    // rem-значений из root не отражает настройку пользователя.
    '--desk-ui-font': `${appearance.uiFontFamily}, system-ui, sans-serif`,
    '--desk-ui-size': `${appearance.uiFontSize}px`,
    '--desk-book-font': `${appearance.fontFamily}, Georgia, serif`,
    '--desk-book-size': `${appearance.fontSize}px`,
    '--ge-font-size': `${appearance.fontSize}px`,
    '--ge-font-body': `${appearance.fontFamily}, Georgia, serif`,
  } as CSSProperties;
}

/** Ширина колонки чтения (текст, сравнение, исходник) из настройки. */
export function contentWidthStyle(lineWidth: number): CSSProperties {
  return { width: `min(100%, ${lineWidth}px)` };
}

type Props = {
  value: AppearanceSettings;
  /** Каждое изменение уходит в BookWindow: применение + DeskApi.setAppearance. */
  onChange: (next: AppearanceSettings) => void;
};

/** Панель настроек оформления: только форма, сохраняет вызывающий. */
export function Appearance({ value, onChange }: Props) {
  const formId = useId();
  // Черновик числовых полей: во время набора «1» не должна превращаться в
  // нижнюю границу; в значение уходит только корректное число.
  const [fontSizeDraft, setFontSizeDraft] = useState<string | null>(null);
  const [uiSizeDraft, setUiSizeDraft] = useState<string | null>(null);
  const [lineWidthDraft, setLineWidthDraft] = useState<string | null>(null);

  const commitFontSize = (raw: string): void => {
    setFontSizeDraft(raw);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      onChange({ ...value, fontSize: clamp(parsed, FONT_SIZE_BOUNDS) });
    }
  };
  const commitLineWidth = (raw: string): void => {
    setLineWidthDraft(raw);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      onChange({ ...value, lineWidth: clamp(parsed, LINE_WIDTH_BOUNDS) });
    }
  };

  return (
    <section className="book__appearance" aria-label="Оформление">
      <div className="book__appearance-row">
        <label htmlFor={`${formId}-theme`}>Тема</label>
        <select
          id={`${formId}-theme`}
          value={value.themeId}
          onChange={(event) => onChange({ ...value, themeId: event.target.value })}
        >
          {themeOptions().map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="book__appearance-row">
        <label htmlFor={`${formId}-ui-font`}>Шрифт интерфейса</label>
        <input id={`${formId}-ui-font`} value={value.uiFontFamily} maxLength={200}
          onChange={(event) => onChange({ ...value, uiFontFamily: event.target.value })} />
      </div>
      <div className="book__appearance-row">
        <label htmlFor={`${formId}-ui-size`}>Размер интерфейса (10–24)</label>
        <input id={`${formId}-ui-size`} type="number" min={10} max={24} step={1}
          value={uiSizeDraft ?? String(value.uiFontSize)} onBlur={() => setUiSizeDraft(null)}
          onChange={(event) => {
            setUiSizeDraft(event.target.value);
            const size = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(size)) onChange({ ...value, uiFontSize: clamp(size, { min: 10, max: 24 }) });
          }} />
      </div>
      <div className="book__appearance-row">
        <label htmlFor={`${formId}-font`}>Шрифт книги</label>
        <input
          id={`${formId}-font`}
          type="text"
          value={value.fontFamily}
          maxLength={200}
          onChange={(event) => onChange({ ...value, fontFamily: event.target.value })}
        />
      </div>
      <div className="book__appearance-row">
        <label htmlFor={`${formId}-font-size`}>Размер шрифта книги (10–48)</label>
        <input
          id={`${formId}-font-size`}
          type="number"
          min={FONT_SIZE_BOUNDS.min}
          max={FONT_SIZE_BOUNDS.max}
          step={1}
          value={fontSizeDraft ?? String(value.fontSize)}
          onChange={(event) => commitFontSize(event.target.value)}
          onBlur={() => setFontSizeDraft(null)}
        />
      </div>
      <div className="book__appearance-row">
        <label htmlFor={`${formId}-line-width`}>Ширина строки (320–1600)</label>
        <input
          id={`${formId}-line-width`}
          type="number"
          min={LINE_WIDTH_BOUNDS.min}
          max={LINE_WIDTH_BOUNDS.max}
          step={10}
          value={lineWidthDraft ?? String(value.lineWidth)}
          onChange={(event) => commitLineWidth(event.target.value)}
          onBlur={() => setLineWidthDraft(null)}
        />
      </div>
    </section>
  );
}
