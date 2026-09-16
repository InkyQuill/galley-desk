import { describe, expect, it } from 'vitest';
import { getTheme } from '@inkyquill/galley-themes';
import { DEFAULT_APPEARANCE, resolveThemeVars, themeOptions } from './appearance';

describe('resolveThemeVars', () => {
  it('resolves a known light theme id directly', () => {
    const vars = resolveThemeVars('galley-light', false);
    expect(vars['--app-bg']).toBe('#f6f4ef');
    expect(vars['--app-accent']).toBe(getTheme('galley-light')!.tokens.app.focus);
  });

  it('falls back to galley-dark for "auto" under a dark system scheme', () => {
    const vars = resolveThemeVars('auto', true);
    expect(vars['--app-bg']).toBe(getTheme('galley-dark')!.tokens.app.bg);
  });

  it('falls back to galley-light for "auto" under a light system scheme', () => {
    const vars = resolveThemeVars('auto', false);
    expect(vars['--app-bg']).toBe(getTheme('galley-light')!.tokens.app.bg);
  });

  it('falls back to galley-light for an unknown theme id', () => {
    const vars = resolveThemeVars('does-not-exist', false);
    expect(vars['--app-bg']).toBe(getTheme('galley-light')!.tokens.app.bg);
  });

  it('uses a darker card shadow for dark themes', () => {
    const light = resolveThemeVars('galley-light', false);
    const dark = resolveThemeVars('galley-dark', false);
    expect(light['--app-card-shadow']).toContain('rgb(31 37 35');
    expect(dark['--app-card-shadow']).toContain('rgb(0 0 0');
  });
});

describe('themeOptions', () => {
  it('lists "Системная" first, followed by every built-in theme', () => {
    const options = themeOptions();
    expect(options[0]).toEqual({ id: 'auto', label: 'Системная' });
    expect(options).toHaveLength(14);
  });
});

describe('DEFAULT_APPEARANCE', () => {
  it('defaults to a 700px reading column and the Geist/Literata font pair', () => {
    expect(DEFAULT_APPEARANCE.lineWidth).toBe(700);
    expect(DEFAULT_APPEARANCE.uiFontFamily).toContain('Geist');
    expect(DEFAULT_APPEARANCE.bookFontFamily).toContain('Literata');
  });
});
