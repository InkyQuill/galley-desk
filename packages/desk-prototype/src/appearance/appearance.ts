import { BUILT_IN_THEMES, getTheme, isThemeId, themeToCssVariables } from '@inkyquill/galley-themes';
import type { ThemeCssVariables, ThemeDefinition } from '@inkyquill/galley-themes';

export const SYSTEM_THEME_ID = 'auto';

export const FONT_SIZE_BOUNDS = { min: 10, max: 48 } as const;
export const LINE_WIDTH_BOUNDS = { min: 320, max: 1600 } as const;

export type AppearanceState = {
  themeId: string;
  uiFontFamily: string;
  bookFontFamily: string;
  fontSize: number;
  lineWidth: number;
};

export const DEFAULT_APPEARANCE: AppearanceState = {
  themeId: SYSTEM_THEME_ID,
  uiFontFamily: 'Geist, system-ui, sans-serif',
  bookFontFamily: 'Literata, Georgia, serif',
  fontSize: 16,
  lineWidth: 700,
};

export function themeOptions(): { id: string; label: string }[] {
  return [
    { id: SYSTEM_THEME_ID, label: 'Системная' },
    ...BUILT_IN_THEMES.map((theme) => ({ id: theme.id, label: theme.label })),
  ];
}

function resolveTheme(themeId: string, systemDark: boolean): ThemeDefinition {
  if (isThemeId(themeId)) return getTheme(themeId)!;
  return getTheme(systemDark ? 'galley-dark' : 'galley-light')!;
}

/**
 * Токены темы плюс два дополнения, которые ещё не опубликованы в
 * @inkyquill/galley-themes (см. спеку, раздел «Новые токены») — здесь они
 * фикстуры прототипа, не часть пакета.
 */
export type ThemeVars = ThemeCssVariables & {
  '--app-accent': string;
  '--app-card-shadow': string;
};

export function resolveThemeVars(themeId: string, systemDark: boolean): ThemeVars {
  const theme = resolveTheme(themeId, systemDark);
  const base = themeToCssVariables(theme);
  const cardShadow =
    theme.scheme === 'dark'
      ? '0 10px 28px -10px rgb(0 0 0 / 45%)'
      : '0 10px 28px -14px rgb(31 37 35 / 28%)';
  return { ...base, '--app-accent': theme.tokens.app.focus, '--app-card-shadow': cardShadow };
}
